import { RpcProvider } from 'starknet';
import { starknetKeccak } from 'starknet/utils/hash';
import { validateAndParseAddress } from 'starknet/utils/address';
import Promise from 'bluebird';
import { addResolversToSchema } from '@graphql-tools/schema';
import getGraphQL, { CheckpointsGraphQLObject, MetadataGraphQLObject } from './graphql';
import { GqlEntityController } from './graphql/controller';
import { createLogger, Logger, LogLevel } from './utils/logger';
import { AsyncMySqlPool, createMySqlPool } from './mysql';
import {
  ContractSourceConfig,
  Block,
  FullBlock,
  Transaction,
  Event,
  EventsMap,
  CheckpointConfig,
  CheckpointOptions,
  CheckpointWriters,
  isFullBlock,
  isDeployTransaction
} from './types';
import { getContractsFromConfig } from './utils/checkpoint';
import { CheckpointRecord, CheckpointsStore, MetadataId } from './stores/checkpoints';
import { GraphQLObjectType, GraphQLSchema } from 'graphql';

export default class Checkpoint {
  public config: CheckpointConfig;
  public writer: CheckpointWriters;
  public schema: string;
  public provider: RpcProvider;

  private readonly entityController: GqlEntityController;
  private readonly log: Logger;

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

    this.provider = new RpcProvider({
      nodeUrl: this.config.network_node_url
    });

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

    this.mysqlConnection = opts?.dbConnection;
  }

  /**
   * Returns an express handler that exposes a GraphQL API to query entities defined
   * in the schema.
   *
   */
  public get graphql() {
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

    const schema = addResolversToSchema({
      schema: new GraphQLSchema({ query }),
      resolvers: this.entityController.generateEntityResolvers(entityQueryFields)
    });

    return getGraphQL(
      schema,
      {
        log: this.log.child({ component: 'resolver' }),
        mysql: this.mysql
      },
      this.entityController.generateSampleQuery()
    );
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

    let block: Block;
    let blockEvents: EventsMap;
    try {
      [block, blockEvents] = await Promise.all([
        this.provider.getBlockWithTxs(blockNum),
        this.getEvents(blockNum)
      ]);

      if (!isFullBlock(block) || block.block_number !== blockNum) {
        this.log.error({ blockNumber: blockNum }, 'invalid block');
        await Promise.delay(12e3);
        return this.next(blockNum);
      }
    } catch (e) {
      if ((e as Error).message.includes('StarknetErrorCode.BLOCK_NOT_FOUND')) {
        this.log.info({ blockNumber: blockNum }, 'block not found');
      } else {
        this.log.error({ blockNumber: blockNum, err: e }, 'getting block failed... retrying');
      }

      await Promise.delay(12e3);
      return this.next(blockNum);
    }

    await this.handleBlock(block, blockEvents);

    await this.store.setMetadata(MetadataId.LastIndexedBlock, block.block_number);

    return this.next(blockNum + 1);
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

  private async getEvents(blockNumber: number): Promise<EventsMap> {
    const events: Event[] = [];

    let continuationToken: string | undefined;
    do {
      const result = await this.provider.getEvents({
        from_block: { block_number: blockNumber },
        to_block: { block_number: blockNumber },
        chunk_size: 1000,
        continuation_token: continuationToken
      });

      events.push(...result.events);

      continuationToken = result.continuation_token;
    } while (continuationToken);

    return events.reduce((acc, event) => {
      if (!acc[event.transaction_hash]) acc[event.transaction_hash] = [];

      acc[event.transaction_hash].push(event);

      return acc;
    }, {});
  }

  private async handleBlock(block: FullBlock, blockEvents: EventsMap) {
    this.log.info({ blockNumber: block.block_number }, 'handling block');

    for (const [i, tx] of block.transactions.entries()) {
      await this.handleTx(
        block,
        i,
        tx,
        tx.transaction_hash ? blockEvents[tx.transaction_hash] || [] : []
      );
    }

    this.log.debug({ blockNumber: block.block_number }, 'handling block done');
  }

  private async handleTx(block: FullBlock, txIndex: number, tx: Transaction, events: Event[]) {
    this.log.debug({ txIndex }, 'handling transaction');

    if (this.config.tx_fn) {
      await this.writer[this.config.tx_fn]({ block, tx, mysql: this.mysql, instance: this });
    }

    for (const source of this.config.sources || []) {
      let foundContractData = false;
      const contract = validateAndParseAddress(source.contract);

      if (
        isDeployTransaction(tx) &&
        source.deploy_fn &&
        contract === validateAndParseAddress(tx.contract_address)
      ) {
        foundContractData = true;
        this.log.info(
          { contract: source.contract, txType: tx.type, handlerFn: source.deploy_fn },
          'found deployment transaction'
        );

        await this.writer[source.deploy_fn]({
          source,
          block,
          tx,
          mysql: this.mysql,
          instance: this
        });
      }

      for (const event of events) {
        if (contract === validateAndParseAddress(event.from_address)) {
          for (const sourceEvent of source.events) {
            if (`0x${starknetKeccak(sourceEvent.name).toString('hex')}` === event.keys[0]) {
              foundContractData = true;
              this.log.info(
                { contract: source.contract, event: sourceEvent.name, handlerFn: sourceEvent.fn },
                'found contract event'
              );

              await this.writer[sourceEvent.fn]({
                source,
                block,
                tx,
                event,
                mysql: this.mysql,
                instance: this
              });
            }
          }
        }
      }

      if (foundContractData) {
        await this.store.insertCheckpoints([
          { blockNumber: block.block_number, contractAddress: source.contract }
        ]);
      }
    }

    this.log.debug({ txIndex }, 'handling transaction done');
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
