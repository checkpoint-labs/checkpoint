import { GraphQLObjectType, GraphQLSchema } from 'graphql';
import { addResolversToSchema } from '@graphql-tools/schema';
import { Knex } from 'knex';
import { Pool as PgPool } from 'pg';
import getGraphQL, { CheckpointsGraphQLObject, MetadataGraphQLObject } from './graphql';
import { GqlEntityController } from './graphql/controller';
import { CheckpointRecord, CheckpointsStore, MetadataId } from './stores/checkpoints';
import { BaseIndexer, BlockNotFoundError } from './providers';
import { createLogger, Logger, LogLevel } from './utils/logger';
import { getConfigChecksum, getContractsFromConfig } from './utils/checkpoint';
import { extendSchema } from './utils/graphql';
import { createKnex } from './knex';
import { createPgPool } from './pg';
import { checkpointConfigSchema } from './schemas';
import { register } from './register';
import { sleep } from './utils/helpers';
import { ContractSourceConfig, CheckpointConfig, CheckpointOptions, TemplateSource } from './types';

const SCHEMA_VERSION = 1;

const BLOCK_PRELOAD_START_RANGE = 1000;
const BLOCK_RELOAD_MIN_RANGE = 10;
const BLOCK_PRELOAD_STEP = 100;
const BLOCK_PRELOAD_TARGET = 10;
const BLOCK_PRELOAD_OFFSET = 50;
const DEFAULT_FETCH_INTERVAL = 2000;

export default class Checkpoint {
  public config: CheckpointConfig;
  public opts?: CheckpointOptions;
  public schema: string;

  private readonly entityController: GqlEntityController;
  private readonly log: Logger;
  private readonly indexer: BaseIndexer;

  private dbConnection: string;
  private knex: Knex;
  private pgPool?: PgPool;
  private checkpointsStore?: CheckpointsStore;
  private activeTemplates: TemplateSource[] = [];
  private preloadStep: number = BLOCK_PRELOAD_START_RANGE;
  private preloadedBlocks: number[] = [];
  private preloadEndBlock = 0;
  private cpBlocksCache: number[] | null;

  constructor(
    config: CheckpointConfig,
    indexer: BaseIndexer,
    schema: string,
    opts?: CheckpointOptions
  ) {
    const validationResult = checkpointConfigSchema.safeParse(config);
    if (validationResult.success === false) {
      throw new Error(`Checkpoint config is invalid: ${validationResult.error.message}`);
    }

    this.config = config;
    this.opts = opts;
    this.schema = extendSchema(schema);

    this.entityController = new GqlEntityController(this.schema, config);

    this.log = createLogger({
      base: { component: 'checkpoint' },
      level: opts?.logLevel || LogLevel.Error,
      ...(opts?.prettifyLogs
        ? {
            transport: {
              target: 'pino-pretty'
            }
          }
        : {})
    });

    this.indexer = indexer;
    this.indexer.init({
      instance: this,
      log: this.log,
      abis: opts?.abis
    });

    this.validateConfig();

    this.cpBlocksCache = [];

    const dbConnection = opts?.dbConnection || process.env.DATABASE_URL;
    if (!dbConnection) {
      throw new Error(
        'a valid connection string or DATABASE_URL environment variable is required to connect to the database'
      );
    }

    this.knex = createKnex(dbConnection);
    this.dbConnection = dbConnection;

    register.setKnex(this.knex);
  }

  public getBaseContext() {
    return {
      log: this.log.child({ component: 'resolver' }),
      knex: this.knex,
      pg: this.pg
    };
  }

  public getSchema() {
    const entityQueryFields = this.entityController.generateQueryFields();
    const coreQueryFields = this.entityController.generateQueryFields([
      MetadataGraphQLObject,
      CheckpointsGraphQLObject
    ]);

    const query = new GraphQLObjectType({
      name: 'Query',
      fields: {
        ...entityQueryFields,
        ...coreQueryFields
      }
    });

    return addResolversToSchema({
      schema: new GraphQLSchema({ query }),
      resolvers: this.entityController.generateEntityResolvers(entityQueryFields)
    });
  }

  /**
   * Returns an express handler that exposes a GraphQL API to query entities defined
   * in the schema.
   *
   */
  public get graphql() {
    const schema = this.getSchema();

    return getGraphQL(schema, this.getBaseContext(), this.entityController.generateSampleQuery());
  }

  public get sourceContracts() {
    return this.indexer.getProvider().formatAddresses(getContractsFromConfig(this.config));
  }

  public getCurrentSources(blockNumber: number) {
    if (!this.config.sources) return [];

    return this.config.sources.filter(source => source.start <= blockNumber);
  }

  /**
   * Starts the indexer.
   *
   * The indexer will invoker the respective writer functions when a contract
   * event is found.
   *
   */
  public async start() {
    this.log.debug('starting');

    await this.validateStore();
    await this.indexer.getProvider().init();

    const templateSources = await this.store.getTemplateSources();
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

    return await this.next(blockNum);
  }

  /**
   * Reset will clear the last synced block informations
   * and force Checkpoint to start indexing from the start
   * block.
   *
   * This will also clear all indexed GraphQL entity records.
   *
   * This should be called when there has been a change to the GraphQL schema
   * or a change to the writer functions logic, so indexing will re-run from
   * the starting block. Also, it should be called the first time Checkpoint
   * is being initialized.
   *
   */
  public async reset() {
    this.log.debug('reset');

    await this.store.createStore();
    await this.store.setMetadata(MetadataId.LastIndexedBlock, 0);
    await this.store.setMetadata(MetadataId.SchemaVersion, SCHEMA_VERSION);

    await this.entityController.createEntityStores(this.knex);
  }

  /**
   * Resets Checkpoint's internal tables (including checkpoints).
   *
   * Calling this function will cause next run of checkpoint to start syncing
   * from the start, block-by-block, until new checkpoints are found.
   *
   */
  public async resetMetadata() {
    await this.store.resetStore();
    await this.store.setMetadata(MetadataId.SchemaVersion, SCHEMA_VERSION);
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
      await this.store.insertTemplateSource(contract, start, name);
    }

    this.addSource({
      contract,
      start,
      abi: template.abi,
      events: template.events
    });
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
    await this.store.createStore();

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

    await this.store.insertCheckpoints(checkpoints);
  }

  public async setLastIndexedBlock(block: number) {
    await this.store.setMetadata(MetadataId.LastIndexedBlock, block);
  }

  public async insertCheckpoints(checkpoints: CheckpointRecord[]) {
    await this.store.insertCheckpoints(checkpoints);
  }

  public async getWriterParams(): Promise<{
    instance: Checkpoint;
  }> {
    return {
      instance: this
    };
  }

  private getConfigStartBlock() {
    if (this.config.start && (this.config.tx_fn || this.config.global_events)) {
      return this.config.start;
    }

    return Math.min(...(this.config.sources?.map(source => source.start) || []));
  }

  private async getStartBlockNum() {
    const start = this.getConfigStartBlock();
    const lastBlock = (await this.store.getMetadataNumber(MetadataId.LastIndexedBlock)) ?? 0;

    const nextBlock = lastBlock + 1;

    return nextBlock > start ? nextBlock : start;
  }

  private async preload(blockNum: number) {
    if (this.preloadedBlocks.length > 0) return this.preloadedBlocks.shift() as number;

    let currentBlock = blockNum;

    while (currentBlock <= this.preloadEndBlock) {
      const endBlock = Math.min(currentBlock + this.preloadStep, this.preloadEndBlock);
      const checkpoints = await this.indexer
        .getProvider()
        .getCheckpointsRange(currentBlock, endBlock);

      const increase =
        checkpoints.length > BLOCK_PRELOAD_TARGET ? -BLOCK_PRELOAD_STEP : +BLOCK_PRELOAD_STEP;
      this.preloadStep = Math.max(BLOCK_RELOAD_MIN_RANGE, this.preloadStep + increase);

      if (checkpoints.length > 0) {
        this.preloadedBlocks = [...new Set(checkpoints.map(cp => cp.blockNumber).sort())];
        return this.preloadedBlocks.shift() as number;
      }

      currentBlock = endBlock + 1;
    }

    return null;
  }

  private async next(blockNum: number) {
    let checkpointBlock;
    if (!this.config.tx_fn && !this.config.global_events) {
      checkpointBlock = await this.getNextCheckpointBlock(blockNum);

      if (checkpointBlock) {
        blockNum = checkpointBlock;
      } else if (blockNum <= this.preloadEndBlock) {
        const preloadedBlock = await this.preload(blockNum);
        blockNum = preloadedBlock || this.preloadEndBlock + 1;
      }
    }

    this.log.debug({ blockNumber: blockNum }, 'next block');

    try {
      register.setCurrentBlock(BigInt(blockNum));

      const initialSources = this.getCurrentSources(blockNum);
      const nextBlockNumber = await this.indexer.getProvider().processBlock(blockNum);
      const sources = this.getCurrentSources(nextBlockNumber);

      if (initialSources.length !== sources.length) {
        this.preloadedBlocks = [];
      }

      return this.next(nextBlockNumber);
    } catch (err) {
      if (err instanceof BlockNotFoundError) {
        if (this.config.optimistic_indexing) {
          try {
            await this.indexer.getProvider().processPool(blockNum);
          } catch (err) {
            this.log.error({ blockNumber: blockNum, err }, 'error occurred during pool processing');
          }
        }
      } else {
        this.log.error({ blockNumber: blockNum, err }, 'error occurred during block processing');
      }

      if (checkpointBlock && this.cpBlocksCache) {
        this.cpBlocksCache.unshift(checkpointBlock);
      }

      await sleep(this.opts?.fetchInterval || DEFAULT_FETCH_INTERVAL);
      return this.next(blockNum);
    }
  }

  private async getNextCheckpointBlock(blockNum: number): Promise<number | null> {
    if (this.cpBlocksCache && this.cpBlocksCache.length !== 0) {
      return this.cpBlocksCache.shift() || null;
    }

    const checkpointBlocks = await this.store.getNextCheckpointBlocks(
      blockNum,
      this.sourceContracts,
      15
    );

    if (checkpointBlocks.length === 0) return null;

    this.cpBlocksCache = checkpointBlocks;
    return this.cpBlocksCache.shift() || null;
  }

  private get store(): CheckpointsStore {
    if (this.checkpointsStore) {
      return this.checkpointsStore;
    }

    return (this.checkpointsStore = new CheckpointsStore(this.knex, this.log));
  }

  private get pg(): PgPool {
    if (this.pgPool) {
      return this.pgPool;
    }

    this.pgPool = createPgPool(this.dbConnection);
    return this.pgPool;
  }

  private validateConfig() {
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

    const missingAbis = usedAbis.filter(abi => !this.opts?.abis?.[abi]);
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

  private async validateStore() {
    const networkIdentifier = await this.indexer.getProvider().getNetworkIdentifier();
    const configChecksum = getConfigChecksum(this.config);

    const storedNetworkIdentifier = await this.store.getMetadata(MetadataId.NetworkIdentifier);
    const storedStartBlock = await this.store.getMetadataNumber(MetadataId.StartBlock);
    const storedConfigChecksum = await this.store.getMetadata(MetadataId.ConfigChecksum);
    const storedSchemaVersion = await this.store.getMetadataNumber(MetadataId.SchemaVersion);
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

      await this.store.setMetadata(MetadataId.NetworkIdentifier, networkIdentifier);
      await this.store.setMetadata(MetadataId.StartBlock, this.getConfigStartBlock());
      await this.store.setMetadata(MetadataId.ConfigChecksum, configChecksum);
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
        await this.store.setMetadata(MetadataId.NetworkIdentifier, networkIdentifier);
      }

      if (!storedStartBlock) {
        await this.store.setMetadata(MetadataId.StartBlock, this.getConfigStartBlock());
      }

      if (!storedConfigChecksum) {
        await this.store.setMetadata(MetadataId.ConfigChecksum, configChecksum);
      }
    }
  }
}
