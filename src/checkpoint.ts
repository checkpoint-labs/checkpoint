import Promise from 'bluebird';
import { GraphQLObjectType, GraphQLSchema } from 'graphql';
import { addResolversToSchema } from '@graphql-tools/schema';
import { Knex } from 'knex';
import { Pool as PgPool } from 'pg';
import getGraphQL, { CheckpointsGraphQLObject, MetadataGraphQLObject } from './graphql';
import { GqlEntityController } from './graphql/controller';
import { CheckpointRecord, CheckpointsStore, MetadataId } from './stores/checkpoints';
import { BaseProvider, StarknetProvider, BlockNotFoundError } from './providers';
import { createLogger, Logger, LogLevel } from './utils/logger';
import { getConfigChecksum, getContractsFromConfig } from './utils/checkpoint';
import { extendSchema } from './utils/graphql';
import { createKnex } from './knex';
import { AsyncMySqlPool, createMySqlPool } from './mysql';
import { createPgPool } from './pg';
import { checkpointConfigSchema } from './schemas';
import { register } from './register';
import {
  ContractSourceConfig,
  CheckpointConfig,
  CheckpointOptions,
  CheckpointWriters,
  TemplateSource
} from './types';

const BLOCK_PRELOAD = 100;
const BLOCK_PRELOAD_OFFSET = 50;
const DEFAULT_FETCH_INTERVAL = 2000;

export default class Checkpoint {
  public config: CheckpointConfig;
  public writer: CheckpointWriters;
  public opts?: CheckpointOptions;
  public schema: string;

  private readonly entityController: GqlEntityController;
  private readonly log: Logger;
  private readonly networkProvider: BaseProvider;

  private dbConnection: string;
  private knex: Knex;
  private mysqlPool?: AsyncMySqlPool;
  private pgPool?: PgPool;
  private checkpointsStore?: CheckpointsStore;
  private activeTemplates: TemplateSource[] = [];
  private sourceContracts: string[];
  private prefetchDone = false;
  private prefetchEndBlock: number | null = null;
  private cpBlocksCache: number[] | null;

  constructor(
    config: CheckpointConfig,
    writer: CheckpointWriters,
    schema: string,
    opts?: CheckpointOptions
  ) {
    const validationResult = checkpointConfigSchema.safeParse(config);
    if (validationResult.success === false) {
      throw new Error(`Checkpoint config is invalid: ${validationResult.error.message}`);
    }

    this.config = config;
    this.writer = writer;
    this.opts = opts;
    this.schema = extendSchema(schema);

    this.validateConfig();

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

    const NetworkProvider = opts?.NetworkProvider || StarknetProvider;
    this.networkProvider = new NetworkProvider({ instance: this, log: this.log, abis: opts?.abis });

    this.sourceContracts = this.networkProvider.formatAddresses(getContractsFromConfig(config));
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
      mysql: this.mysql,
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
    await this.networkProvider.init();

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
    const lastPrefetchedBlock =
      (await this.store.getMetadataNumber(MetadataId.LastPrefetchedBlock)) ?? blockNum;
    this.prefetchEndBlock =
      (await this.networkProvider.getLatestBlockNumber()) - BLOCK_PRELOAD_OFFSET;

    if (!this.config.disable_checkpoints) {
      this.nextEvents(Math.max(lastPrefetchedBlock, blockNum));
    }

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
    this.log.debug('reset metadata');

    await this.store.resetStore();
  }

  private addSource(source: ContractSourceConfig) {
    if (!this.config.sources) this.config.sources = [];

    this.config.sources.push(source);
    this.sourceContracts = this.networkProvider.formatAddresses(
      getContractsFromConfig(this.config)
    );
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

    checkpointBlocks.forEach(cp => {
      cp.blocks.forEach(blockNumber => {
        checkpoints.push({ blockNumber, contractAddress: cp.contract });
      });
    });

    await this.store.insertCheckpoints(checkpoints);
  }

  public async setLastIndexedBlock(block: number) {
    await this.store.setMetadata(MetadataId.LastIndexedBlock, block);
  }

  public async insertCheckpoints(checkpoints: { blockNumber: number; contractAddress: string }[]) {
    await this.store.insertCheckpoints(checkpoints);
  }

  public async getWriterParams(): Promise<{
    instance: Checkpoint;
    knex: Knex;
    mysql: AsyncMySqlPool;
    pg: PgPool;
  }> {
    return {
      instance: this,
      mysql: this.mysql,
      pg: this.pg
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

  private async nextEvents(blockNum: number) {
    if (!this.prefetchEndBlock) throw new Error('prefetchEndBlock is not set');
    if (blockNum > this.prefetchEndBlock) {
      this.prefetchDone = true;
      return;
    }

    let nextBlock = blockNum;
    try {
      const toBlock = Math.min(blockNum + BLOCK_PRELOAD, this.prefetchEndBlock);
      const checkpoints = await this.networkProvider.getCheckpointsRange(blockNum, toBlock);

      await this.store.insertCheckpoints(checkpoints);
      await this.store.setMetadata(MetadataId.LastPrefetchedBlock, toBlock);

      this.log.info(
        { blockNumber: blockNum, checkpointsLength: checkpoints.length },
        'checkpoints inserted'
      );

      nextBlock = blockNum + BLOCK_PRELOAD + 1;
    } catch (e) {
      this.log.error(
        { blockNumber: blockNum, err: e },
        'error occurred during checkpoint fetching'
      );

      await Promise.delay(10000);
    }

    this.nextEvents(nextBlock);
  }

  private async next(blockNum: number) {
    if (!this.prefetchEndBlock) throw new Error('prefetchEndBlock is not set');

    let checkpointBlock;
    if (!this.config.disable_checkpoints && !this.config.tx_fn && !this.config.global_events) {
      if (blockNum <= this.prefetchEndBlock) {
        checkpointBlock = await this.getNextCheckpointBlock(blockNum);

        if (checkpointBlock) {
          blockNum = checkpointBlock;
        } else {
          if (this.prefetchDone) {
            return this.next(this.prefetchEndBlock + 1);
          }

          this.log.info({ blockNumber: blockNum }, 'no more checkpoint blocks. waiting');
          await Promise.delay(10000);
          return this.next(blockNum);
        }
      }
    }

    this.log.debug({ blockNumber: blockNum }, 'next block');

    try {
      const nextBlock = await this.networkProvider.processBlock(blockNum);
      await this.store.purgeCheckpointBlocks(blockNum, this.sourceContracts);

      return this.next(nextBlock);
    } catch (err) {
      if (this.config.optimistic_indexing && err instanceof BlockNotFoundError) {
        try {
          await this.networkProvider.processPool(blockNum);
        } catch (err) {
          this.log.error({ blockNumber: blockNum, err }, 'error occurred during pool processing');
        }
      } else {
        this.log.error({ blockNumber: blockNum, err }, 'error occurred during block processing');
      }

      if (checkpointBlock && this.cpBlocksCache) {
        this.cpBlocksCache.unshift(checkpointBlock);
      }

      await Promise.delay(this.opts?.fetchInterval || DEFAULT_FETCH_INTERVAL);
      return this.next(blockNum);
    }
  }

  private async getNextCheckpointBlock(blockNum: number): Promise<number | null> {
    if (this.cpBlocksCache && this.cpBlocksCache.length !== 0) {
      return this.cpBlocksCache.shift();
    }

    const checkpointBlocks = await this.store.getNextCheckpointBlocks(
      blockNum,
      this.sourceContracts,
      15
    );

    if (checkpointBlocks.length === 0) return null;

    this.cpBlocksCache = checkpointBlocks;
    return this.cpBlocksCache.shift();
  }

  private get store(): CheckpointsStore {
    if (this.checkpointsStore) {
      return this.checkpointsStore;
    }

    return (this.checkpointsStore = new CheckpointsStore(this.knex, this.log));
  }

  /**
   * returns AsyncMySqlPool if mysql client is used, otherwise returns Proxy that
   * will notify user when used that mysql is not available with other clients
   */
  private get mysql(): AsyncMySqlPool {
    if (this.mysqlPool) {
      return this.mysqlPool;
    }

    if (this.knex.client.config.client === 'mysql') {
      this.mysqlPool = createMySqlPool(this.dbConnection);
      return this.mysqlPool;
    }

    return new Proxy(
      {},
      {
        get() {
          throw new Error('mysql is only accessible when using MySQL database.');
        }
      }
    ) as AsyncMySqlPool;
  }

  /**
   * returns pg's Pool if pg client is used, otherwise returns Proxy that
   * will notify user when used that mysql is not available with other clients
   */
  private get pg(): PgPool {
    if (this.pgPool) {
      return this.pgPool;
    }

    if (this.knex.client.config.client === 'pg') {
      this.pgPool = createPgPool(this.dbConnection);
      return this.pgPool;
    }

    return new Proxy(
      {},
      {
        get() {
          throw new Error('pg is only accessible when using PostgreSQL database.');
        }
      }
    ) as PgPool;
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
    const missingWriters = usedWriters.filter(writer => !this.writer[writer.fn]);

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
    const networkIdentifier = await this.networkProvider.getNetworkIdentifier();
    const configChecksum = getConfigChecksum(this.config);

    const storedNetworkIdentifier = await this.store.getMetadata(MetadataId.NetworkIdentifier);
    const storedStartBlock = await this.store.getMetadataNumber(MetadataId.StartBlock);
    const storedConfigChecksum = await this.store.getMetadata(MetadataId.ConfigChecksum);
    const hasNetworkChanged =
      storedNetworkIdentifier && storedNetworkIdentifier !== networkIdentifier;
    const hasStartBlockChanged =
      storedStartBlock && storedStartBlock !== this.getConfigStartBlock();
    const hasConfigChanged = storedConfigChecksum && storedConfigChecksum !== configChecksum;

    if (
      (hasNetworkChanged || hasStartBlockChanged || hasConfigChanged) &&
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
