import Promise from 'bluebird';
import { addResolversToSchema } from '@graphql-tools/schema';
import getGraphQL, { CheckpointsGraphQLObject, MetadataGraphQLObject } from './graphql';
import { GqlEntityController } from './graphql/controller';
import { BaseProvider, StarknetProvider } from './providers';

import { createLogger, Logger, LogLevel } from './utils/logger';
import { AsyncMySqlPool, createMySqlPool } from './mysql';
import {
  ContractSourceConfig,
  CheckpointConfig,
  CheckpointOptions,
  CheckpointWriters
} from './types';
import { getContractsFromConfig } from './utils/checkpoint';
import { CheckpointRecord, CheckpointsStore, MetadataId } from './stores/checkpoints';
import { GraphQLObjectType, GraphQLSchema } from 'graphql';

export default class Checkpoint {
  public config: CheckpointConfig;
  public writer: CheckpointWriters;
  public schema: string;

  private readonly entityController: GqlEntityController;
  private readonly log: Logger;
  private readonly networkProvider: BaseProvider;

  private mysqlPool?: AsyncMySqlPool;
  private mysqlConnection?: string;
  private checkpointsStore?: CheckpointsStore;
  private sourceContracts: string[];
  private cpBlocksCache: number[] | null;

  constructor(
    config: CheckpointConfig,
    writer: CheckpointWriters,
    schema: string,
    opts?: CheckpointOptions
  ) {
    this.config = config;
    this.writer = writer;
    this.schema = schema;
    this.entityController = new GqlEntityController(schema, opts);

    this.sourceContracts = getContractsFromConfig(config);
    this.cpBlocksCache = [];

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

    this.mysqlConnection = opts?.dbConnection;
  }

  public getBaseContext() {
    return {
      log: this.log.child({ component: 'resolver' }),
      mysql: this.mysql
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

  /**
   * Starts the indexer.
   *
   * The indexer will invoker the respective writer functions when a contract
   * event is found.
   *
   */
  public async start() {
    this.log.debug('starting');

    const blockNum = await this.getStartBlockNum();
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

    await this.entityController.createEntityStores(this.mysql);
  }

  public addSource(source: ContractSourceConfig) {
    if (!this.config.sources) this.config.sources = [];

    this.config.sources.push(source);
    this.sourceContracts = getContractsFromConfig(this.config);
    this.cpBlocksCache = [];
  }

  public executeTemplate(name: string, { contract, start }: { contract: string; start: number }) {
    const template = this.config.templates?.[name];

    if (!template) {
      this.log.warn({ name }, 'template not found');
      return;
    }

    this.addSource({
      contract,
      start,
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

  public getWriterParams(): { instance: Checkpoint; mysql: AsyncMySqlPool } {
    return {
      instance: this,
      mysql: this.mysql
    };
  }

  private async getStartBlockNum() {
    let start = 0;
    let lastBlock = await this.store.getMetadataNumber(MetadataId.LastIndexedBlock);
    lastBlock = lastBlock ?? 0;

    const nextBlock = lastBlock + 1;

    if (this.config.tx_fn) {
      if (this.config.start) start = this.config.start;
    } else {
      (this.config.sources || []).forEach(source => {
        start = start === 0 || start > source.start ? source.start : start;
      });
    }
    return nextBlock > start ? nextBlock : start;
  }

  private async next(blockNum: number) {
    if (!this.config.tx_fn) {
      const checkpointBlock = await this.getNextCheckpointBlock(blockNum);
      if (checkpointBlock) blockNum = checkpointBlock;
    }

    this.log.debug({ blockNumber: blockNum }, 'next block');

    try {
      await this.networkProvider.processBlock(blockNum);

      return this.next(blockNum + 1);
    } catch (err) {
      await Promise.delay(12e3);
      return this.next(blockNum);
    }
  }

  private async getNextCheckpointBlock(blockNum: number): Promise<number | null> {
    if (this.cpBlocksCache === null) {
      // cache is null when we can no more find a record in the database
      // so exiting early here to avoid polling the database in subsequent
      // loops.
      return null;
    }

    if (this.cpBlocksCache.length !== 0) {
      return this.cpBlocksCache.shift();
    }

    const checkpointBlocks = await this.store.getNextCheckpointBlocks(
      blockNum,
      this.sourceContracts
    );
    if (checkpointBlocks.length === 0) {
      this.log.info({ blockNumber: blockNum }, 'no more checkpoint blocks in store');
      // disabling cache to stop polling database
      this.cpBlocksCache = null;

      return null;
    }

    this.cpBlocksCache = checkpointBlocks;
    return this.cpBlocksCache.shift();
  }

  private get store(): CheckpointsStore {
    if (this.checkpointsStore) {
      return this.checkpointsStore;
    }

    return (this.checkpointsStore = new CheckpointsStore(this.mysql, this.log));
  }

  private get mysql(): AsyncMySqlPool {
    if (this.mysqlPool) {
      return this.mysqlPool;
    }

    // lazy initialization of mysql connection
    return (this.mysqlPool = createMySqlPool(this.mysqlConnection));
  }
}
