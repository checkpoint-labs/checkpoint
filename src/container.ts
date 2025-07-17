import { BaseIndexer, BlockNotFoundError, Instance, ReorgDetectedError } from './providers';
import { CheckpointConfig, CheckpointOptions, ContractSourceConfig, TemplateSource } from './types';
import { CheckpointRecord, CheckpointsStore, MetadataId } from './stores/checkpoints';
import { Logger } from './utils/logger';
import { getConfigChecksum, getContractsFromConfig } from './utils/checkpoint';
import { GqlEntityController } from './graphql/controller';
import { Knex } from 'knex';
import { sleep } from './utils/helpers';
import { register } from './register';
import { getTableName } from './utils/database';
import {
  CheckpointRangeAdapter,
  CheckpointRangeUtils
} from './range-optimizer/checkpoint-integration';

const SCHEMA_VERSION = 1;

const BLOCK_PRELOAD_START_RANGE = 1000;
const BLOCK_RELOAD_MIN_RANGE = 10;
const BLOCK_PRELOAD_STEP = 100;
const BLOCK_PRELOAD_TARGET = 10;
const BLOCK_PRELOAD_OFFSET = 50;

const CHECK_LATEST_BLOCK_INTERVAL = 50;

const DEFAULT_FETCH_INTERVAL = 2000;

export class Container implements Instance {
  private indexerName: string;

  public config: CheckpointConfig;
  public opts?: CheckpointOptions;
  public schema: string;

  private store: CheckpointsStore;
  private readonly log: Logger;
  private readonly indexer: BaseIndexer;
  private readonly entityController: GqlEntityController;
  private knex: Knex;

  private activeTemplates: TemplateSource[] = [];
  private cpBlocksCache: number[] | null = [];
  private blockHashCache: { blockNumber: number; hash: string } | null = null;

  private preloadStep: number = BLOCK_PRELOAD_START_RANGE;
  private preloadedBlocks: number[] = [];
  private preloadEndBlock = 0;

  // Range optimization integration
  private rangeAdapter: CheckpointRangeAdapter | null = null;
  private rangeOptimizerEnabled = false;

  constructor(
    indexerName: string,
    log: Logger,
    knex: Knex,
    store: CheckpointsStore,
    entityController: GqlEntityController,
    config: CheckpointConfig,
    indexer: BaseIndexer,
    schema: string,
    opts?: CheckpointOptions
  ) {
    this.indexerName = indexerName;
    this.log = log.child({ component: 'container', indexer: indexerName });
    this.knex = knex;
    this.store = store;
    this.entityController = entityController;
    this.config = config;
    this.indexer = indexer;
    this.schema = schema;
    this.opts = opts;

    this.indexer.init({
      instance: this,
      log: this.log,
      abis: config.abis
    });

    // Range optimizer will be initialized in start() method
  }

  private async initializeRangeOptimizer() {
    // Range optimizer is enabled by default, but can be disabled via options
    if (this.opts?.rangeOptimization === false) {
      this.rangeOptimizerEnabled = false;
      return;
    }

    try {
      const networkId = await this.indexer.getProvider().getNetworkIdentifier();
      const rangeConfig = CheckpointRangeUtils.getNetworkConfig(networkId);

      // Apply any custom config from options
      if (this.opts?.rangeOptimizationConfig) {
        Object.assign(rangeConfig, this.opts.rangeOptimizationConfig);
      }

      this.rangeAdapter = CheckpointRangeUtils.createAdapter(networkId, rangeConfig);
      this.rangeOptimizerEnabled = true;

      this.log.info(`Range optimizer initialized for network: ${networkId}`);
    } catch (error) {
      this.log.warn(
        `Failed to initialize range optimizer, falling back to default logic: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      this.rangeOptimizerEnabled = false;
    }
  }

  public get sourceContracts() {
    return this.indexer.getProvider().formatAddresses(getContractsFromConfig(this.config));
  }

  public getCurrentSources(blockNumber: number) {
    if (!this.config.sources) return [];

    return this.config.sources.filter(source => source.start <= blockNumber);
  }

  private async getNextCheckpointBlock(blockNum: number): Promise<number | null> {
    if (this.cpBlocksCache && this.cpBlocksCache.length !== 0) {
      return this.cpBlocksCache.shift() || null;
    }

    const checkpointBlocks = await this.store.getNextCheckpointBlocks(
      this.indexerName,
      blockNum,
      this.sourceContracts,
      15
    );

    if (checkpointBlocks.length === 0) return null;

    this.cpBlocksCache = checkpointBlocks;
    return this.cpBlocksCache.shift() || null;
  }

  private async getBlockHash(blockNumber: number): Promise<string | null> {
    if (this.blockHashCache && this.blockHashCache.blockNumber === blockNumber) {
      return this.blockHashCache.hash;
    }

    return this.store.getBlockHash(this.indexerName, blockNumber);
  }

  private addSource(source: ContractSourceConfig) {
    if (!this.config.sources) this.config.sources = [];

    this.config.sources.push(source);
    this.cpBlocksCache = [];
  }

  public async executeTemplate(
    name: string,
    { contract, start }: { contract: string; start: number },
    persist = true
  ) {
    const template = this.config.templates?.[name];

    if (!template) {
      this.log.warn({ name }, 'template not found');
      return;
    }

    const existingTemplate = this.activeTemplates.find(
      template =>
        template.template === name &&
        template.contractAddress === contract &&
        template.startBlock === start
    );

    if (existingTemplate) return;
    this.activeTemplates.push({ template: name, contractAddress: contract, startBlock: start });

    if (persist) {
      await this.store.insertTemplateSource(this.indexerName, contract, start, name);
    }

    this.addSource({
      contract,
      start,
      abi: template.abi,
      events: template.events
    });
  }

  getWriterHelpers() {
    return {
      executeTemplate: this.executeTemplate.bind(this)
    };
  }

  public async setBlockHash(blockNum: number, hash: string) {
    this.blockHashCache = { blockNumber: blockNum, hash };

    return this.store.setBlockHash(this.indexerName, blockNum, hash);
  }

  public async setLastIndexedBlock(block: number) {
    await this.store.setMetadata(this.indexerName, MetadataId.LastIndexedBlock, block);
  }

  public async insertCheckpoints(checkpoints: CheckpointRecord[]) {
    await this.store.insertCheckpoints(this.indexerName, checkpoints);
  }

  /**
   * Starts the indexer.
   *
   * The indexer will invoker the respective writer functions when a contract
   * event is found.
   *
   */
  public async start() {
    await this.validateStore();
    await this.indexer.getProvider().init();

    // Initialize range optimizer after provider is ready
    await this.initializeRangeOptimizer();

    if (this.rangeAdapter) {
      await this.rangeAdapter.initialize();
    }

    const templateSources = await this.store.getTemplateSources(this.indexerName);
    await Promise.all(
      templateSources.map(source =>
        this.executeTemplate(
          source.template,
          {
            contract: source.contractAddress,
            start: source.startBlock
          },
          false
        )
      )
    );

    const blockNum = await this.getStartBlockNum();
    this.preloadEndBlock =
      (await this.indexer.getProvider().getLatestBlockNumber()) - BLOCK_PRELOAD_OFFSET;

    return this.process(blockNum);
  }

  private async preload(blockNum: number) {
    if (this.preloadedBlocks.length > 0) return this.preloadedBlocks.shift() as number;

    let currentBlock = blockNum;

    while (currentBlock <= this.preloadEndBlock) {
      const endBlock = await this.calculateEndBlock(currentBlock);
      let checkpoints: CheckpointRecord[];
      const startTime = Date.now();

      try {
        this.log.info({ start: currentBlock, end: endBlock }, 'preloading blocks');
        checkpoints = await this.indexer.getProvider().getCheckpointsRange(currentBlock, endBlock);

        // Record successful preload with range optimizer
        if (this.rangeAdapter) {
          const responseTime = Date.now() - startTime;
          this.rangeAdapter.processPreloadResult(
            currentBlock,
            endBlock,
            true,
            checkpoints.length,
            undefined,
            responseTime
          );
        }
      } catch (e) {
        this.log.error(
          { blockNumber: currentBlock, err: e },
          'error occurred during checkpoint fetching'
        );

        // Record failed preload with range optimizer
        if (this.rangeAdapter) {
          const responseTime = Date.now() - startTime;
          this.rangeAdapter.processPreloadResult(
            currentBlock,
            endBlock,
            false,
            0,
            e as Error,
            responseTime
          );
        }

        await sleep(this.config.fetch_interval || DEFAULT_FETCH_INTERVAL);
        continue;
      }

      // Update preload step using optimizer or fallback logic
      this.updatePreloadStep(checkpoints.length);

      if (checkpoints.length > 0) {
        this.preloadedBlocks = [
          ...new Set(checkpoints.map(cp => cp.blockNumber).sort((a, b) => a - b))
        ];
        return this.preloadedBlocks.shift() as number;
      }

      currentBlock = endBlock + 1;
    }

    return null;
  }

  private async calculateEndBlock(currentBlock: number): Promise<number> {
    if (this.rangeAdapter && this.rangeOptimizerEnabled) {
      // Use range optimizer to calculate optimal end block
      const optimalRange = await this.rangeAdapter.getOptimalPreloadRange(
        currentBlock,
        this.preloadEndBlock,
        0 // We don't have event estimation for preload
      );
      return Math.min(currentBlock + optimalRange, this.preloadEndBlock);
    } else {
      // Use original logic
      return Math.min(currentBlock + this.preloadStep, this.preloadEndBlock);
    }
  }

  private updatePreloadStep(checkpointCount: number) {
    if (this.rangeAdapter && this.rangeOptimizerEnabled) {
      // Range optimizer handles the step calculation
      return;
    }

    // Original logic for fallback
    const increase =
      checkpointCount > BLOCK_PRELOAD_TARGET ? -BLOCK_PRELOAD_STEP : +BLOCK_PRELOAD_STEP;
    this.preloadStep = Math.max(BLOCK_RELOAD_MIN_RANGE, this.preloadStep + increase);
  }

  private async process(startBlockNumber: number) {
    let blockNumber = startBlockNumber;

    while (true) {
      let checkpointBlock: number | null = null;
      let preloadedBlock: number | null = null;

      if (!this.config.tx_fn && !this.config.global_events) {
        checkpointBlock = await this.getNextCheckpointBlock(blockNumber);

        if (checkpointBlock) {
          blockNumber = checkpointBlock;
        } else if (blockNumber <= this.preloadEndBlock) {
          preloadedBlock = await this.preload(blockNumber);
          blockNumber = preloadedBlock || this.preloadEndBlock + 1;
        }
      }

      if (!checkpointBlock && !preloadedBlock) {
        if (blockNumber % CHECK_LATEST_BLOCK_INTERVAL === 0) {
          try {
            const latestBlock = await this.indexer.getProvider().getLatestBlockNumber();

            this.log.info(
              { latestBlock, behind: latestBlock - blockNumber },
              'checking latest block'
            );

            if (latestBlock > blockNumber + BLOCK_PRELOAD_OFFSET * 2) {
              this.log.info(
                { latestBlock, blockNum: blockNumber },
                `fell more than ${BLOCK_PRELOAD_OFFSET * 2} blocks behind, reverting to preload`
              );

              this.preloadEndBlock = latestBlock - BLOCK_PRELOAD_OFFSET;
            }
          } catch (e) {
            this.log.error(
              { blockNumber: blockNumber, err: e },
              'error occurred during latest block check, ignoring for now'
            );
          }
        }
      }

      this.log.debug({ blockNumber: blockNumber }, 'next block');

      try {
        register.setCurrentBlock(this.indexerName, BigInt(blockNumber));

        const initialSources = this.getCurrentSources(blockNumber);
        const parentHash = await this.getBlockHash(blockNumber - 1);
        const nextBlockNumber = await this.indexer
          .getProvider()
          .processBlock(blockNumber, parentHash);
        const sources = this.getCurrentSources(nextBlockNumber);

        if (initialSources.length !== sources.length) {
          this.preloadedBlocks = [];
        }

        blockNumber = nextBlockNumber;
      } catch (err) {
        if (err instanceof BlockNotFoundError) {
          if (this.config.optimistic_indexing) {
            try {
              await this.indexer.getProvider().processPool(blockNumber);
            } catch (err) {
              this.log.error(
                { blockNumber: blockNumber, err },
                'error occurred during pool processing'
              );
            }
          }
        } else if (err instanceof ReorgDetectedError) {
          blockNumber = await this.handleReorg(blockNumber);
          continue;
        } else {
          this.log.error(
            { blockNumber: blockNumber, err },
            'error occurred during block processing'
          );
        }

        // NOTE: should we do it on reorg?

        if (checkpointBlock && this.cpBlocksCache) {
          this.cpBlocksCache.unshift(checkpointBlock);
        }

        if (preloadedBlock && this.preloadedBlocks) {
          this.preloadedBlocks.unshift(preloadedBlock);
        }

        await sleep(this.config.fetch_interval || DEFAULT_FETCH_INTERVAL);
      }
    }
  }

  private async handleReorg(blockNumber: number) {
    this.log.info({ blockNumber }, 'handling reorg');

    let current = blockNumber - 1;
    let lastGoodBlock: null | number = null;
    while (lastGoodBlock === null) {
      try {
        const storedBlockHash = await this.store.getBlockHash(this.indexerName, current);
        const currentBlockHash = await this.indexer.getProvider().getBlockHash(current);

        if (storedBlockHash === null || storedBlockHash === currentBlockHash) {
          lastGoodBlock = current;
        } else {
          current -= 1;
        }
      } catch (e) {
        this.log.error({ blockNumber: current, err: e }, 'error occurred during block hash check');
        await sleep(this.config.fetch_interval || DEFAULT_FETCH_INTERVAL);
      }
    }

    const entities = await this.entityController.schemaObjects;
    const tables = entities.map(entity => getTableName(entity.name.toLowerCase()));

    await this.knex.transaction(async trx => {
      for (const tableName of tables) {
        await trx
          .table(tableName)
          .where('_indexer', this.indexerName)
          .andWhereRaw('lower(block_range) > ?', [lastGoodBlock])
          .delete();

        await trx
          .table(tableName)
          .where('_indexer', this.indexerName)
          .andWhereRaw('block_range @> int8(??)', [lastGoodBlock])
          .update({
            block_range: this.knex.raw('int8range(lower(block_range), NULL)')
          });
      }
    });

    // TODO: when we have full transaction support, we should include this in the transaction
    await this.store.removeFutureData(this.indexerName, lastGoodBlock);

    this.cpBlocksCache = null;
    this.blockHashCache = null;

    this.log.info({ blockNumber: lastGoodBlock }, 'reorg resolved');

    return lastGoodBlock + 1;
  }

  public async reset() {
    await this.store.setMetadata(this.indexerName, MetadataId.LastIndexedBlock, 0);
    await this.store.setMetadata(this.indexerName, MetadataId.SchemaVersion, SCHEMA_VERSION);
    await this.store.removeBlocks(this.indexerName);
  }

  public async resetMetadata() {
    await this.store.setMetadata(this.indexerName, MetadataId.SchemaVersion, SCHEMA_VERSION);
  }

  /**
   * Registers the blocks where a contracts event can be found.
   * This will be used as a skip list for checkpoints while
   * indexing relevant blocks. Using this seed function can significantly
   * reduce the time for Checkpoint to re-index blocks.
   *
   * This should be called before the start() method is called.
   *
   */
  public async seedCheckpoints(
    checkpointBlocks: { contract: string; blocks: number[] }[]
  ): Promise<void> {
    const checkpoints: CheckpointRecord[] = [];

    let finalBlock = 0;
    checkpointBlocks.forEach(cp => {
      cp.blocks.forEach(blockNumber => {
        finalBlock = Math.max(finalBlock, blockNumber);
        checkpoints.push({
          blockNumber,
          contractAddress: cp.contract
        });
      });
    });

    await this.store.insertCheckpoints(this.indexerName, checkpoints);
  }

  public getConfigStartBlock() {
    if (this.config.start && (this.config.tx_fn || this.config.global_events)) {
      return this.config.start;
    }

    return Math.min(...(this.config.sources?.map(source => source.start) || []));
  }

  public async getStartBlockNum() {
    const start = this.getConfigStartBlock();
    const lastBlock =
      (await this.store.getMetadataNumber(this.indexerName, MetadataId.LastIndexedBlock)) ?? 0;

    const nextBlock = lastBlock + 1;

    return nextBlock > start ? nextBlock : start;
  }

  public validateConfig() {
    const sources = this.config.sources ?? [];
    const templates = Object.values(this.config.templates ?? {});

    const usedAbis = [
      ...sources.map(source => source.abi),
      ...templates.map(template => template.abi)
    ].filter(abi => abi) as string[];
    const usedWriters = [
      ...sources.flatMap(source => source.events),
      ...templates.flatMap(template => template.events)
    ];

    const missingAbis = usedAbis.filter(abi => !this.config.abis?.[abi]);
    const missingWriters = usedWriters.filter(
      writer => !this.indexer.getHandlers().includes(writer.fn)
    );

    if (missingAbis.length > 0) {
      throw new Error(
        `Following ABIs are used (${missingAbis.join(', ')}), but they are missing in opts.abis`
      );
    }

    if (missingWriters.length > 0) {
      throw new Error(
        `Following writers are used (${missingWriters
          .map(writer => writer.fn)
          .join(', ')}), but they are not defined`
      );
    }
  }

  public async validateStore() {
    const networkIdentifier = await this.indexer.getProvider().getNetworkIdentifier();
    const configChecksum = getConfigChecksum(this.config);

    const storedNetworkIdentifier = await this.store.getMetadata(
      this.indexerName,
      MetadataId.NetworkIdentifier
    );
    const storedStartBlock = await this.store.getMetadataNumber(
      this.indexerName,
      MetadataId.StartBlock
    );
    const storedConfigChecksum = await this.store.getMetadata(
      this.indexerName,
      MetadataId.ConfigChecksum
    );
    const storedSchemaVersion = await this.store.getMetadataNumber(
      this.indexerName,
      MetadataId.SchemaVersion
    );

    const hasNetworkChanged =
      storedNetworkIdentifier && storedNetworkIdentifier !== networkIdentifier;
    const hasStartBlockChanged =
      storedStartBlock && storedStartBlock !== this.getConfigStartBlock();
    const hasConfigChanged = storedConfigChecksum && storedConfigChecksum !== configChecksum;
    const hasSchemaChanged = storedSchemaVersion !== SCHEMA_VERSION;

    if (
      (hasNetworkChanged || hasStartBlockChanged || hasConfigChanged || hasSchemaChanged) &&
      this.opts?.resetOnConfigChange
    ) {
      await this.resetMetadata();
      await this.reset();

      await this.store.setMetadata(
        this.indexerName,
        MetadataId.NetworkIdentifier,
        networkIdentifier
      );
      await this.store.setMetadata(
        this.indexerName,
        MetadataId.StartBlock,
        this.getConfigStartBlock()
      );
      await this.store.setMetadata(this.indexerName, MetadataId.ConfigChecksum, configChecksum);
    } else if (hasNetworkChanged) {
      this.log.error(
        `network identifier changed from ${storedNetworkIdentifier} to ${networkIdentifier}.
        You probably should reset the database by calling .reset() and resetMetadata().
          You can also set resetOnConfigChange to true in Checkpoint options to do this automatically.`
      );

      throw new Error('network identifier changed');
    } else if (hasStartBlockChanged) {
      this.log.error(
        `start block changed from ${storedStartBlock} to ${this.getConfigStartBlock()}.
        You probably should reset the database by calling .reset() and resetMetadata().
        You can also set resetOnConfigChange to true in Checkpoint options to do this automatically.`
      );

      throw new Error('start block changed');
    } else if (hasConfigChanged) {
      this.log.error(
        `config checksum changed from ${storedConfigChecksum} to ${configChecksum} to due to a change in the config.
          You probably should reset the database by calling .reset() and resetMetadata().
          You can also set resetOnConfigChange to true in Checkpoint options to do this automatically.`
      );

      throw new Error('config changed');
    } else if (hasSchemaChanged) {
      this.log.error(
        `schema version changed from ${storedSchemaVersion} to ${SCHEMA_VERSION}.
          You probably should reset the database by calling .reset() and resetMetadata().
          You can also set resetOnConfigChange to true in Checkpoint options to do this automatically.`
      );

      throw new Error('schema changed');
    } else {
      if (!storedNetworkIdentifier) {
        await this.store.setMetadata(
          this.indexerName,
          MetadataId.NetworkIdentifier,
          networkIdentifier
        );
      }

      if (!storedStartBlock) {
        await this.store.setMetadata(
          this.indexerName,
          MetadataId.StartBlock,
          this.getConfigStartBlock()
        );
      }

      if (!storedConfigChecksum) {
        await this.store.setMetadata(this.indexerName, MetadataId.ConfigChecksum, configChecksum);
      }
    }
  }

  // Range optimizer management methods
  public getNetworkHealth() {
    if (this.rangeAdapter) {
      return this.rangeAdapter.getNetworkHealth();
    }
    return null;
  }

  public enableRangeOptimizer() {
    if (this.rangeAdapter) {
      this.rangeAdapter.setEnabled(true);
      this.rangeOptimizerEnabled = true;
      this.log.info('Range optimizer enabled');
    }
  }

  public disableRangeOptimizer() {
    if (this.rangeAdapter) {
      this.rangeAdapter.setEnabled(false);
      this.rangeOptimizerEnabled = false;
      this.log.info('Range optimizer disabled');
    }
  }

  public resetRangeOptimizer() {
    if (this.rangeAdapter) {
      this.rangeAdapter.reset();
      this.log.info('Range optimizer reset');
    }
  }

  public isRangeOptimizerEnabled(): boolean {
    return this.rangeOptimizerEnabled;
  }

  public async shutdownRangeOptimizer() {
    if (this.rangeAdapter) {
      await this.rangeAdapter.shutdown();
    }
  }
}
