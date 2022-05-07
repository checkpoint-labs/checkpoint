import { GetBlockResponse, Provider } from 'starknet';
import { starknetKeccak } from 'starknet/utils/hash';
import { validateAndParseAddress } from 'starknet/utils/address';
import Promise from 'bluebird';
import getGraphQL, { CheckpointsGraphQLObject, MetadataGraphQLObject } from './graphql';
import { GqlEntityController } from './graphql/controller';
import { createLogger, Logger, LogLevel } from './utils/logger';
import { AsyncMySqlPool, createMySqlPool } from './mysql';
import { CheckpointConfig, CheckpointOptions, SupportedNetworkName } from './types';
import { getContractsFromConfig } from './utils/checkpoint';
import { CheckpointRecord, CheckpointsStore, MetadataId } from './stores/checkpoints';
import { GraphQLObjectType } from 'graphql';

export default class Checkpoint {
  public config: CheckpointConfig;
  public writer;
  public schema: string;
  public provider: Provider;

  private readonly entityController: GqlEntityController;
  private readonly log: Logger;
  private readonly sourceContracts: string[];

  private mysqlPool?: AsyncMySqlPool;
  private mysqlConnection?: string;
  private checkpointsStore?: CheckpointsStore;
  private cpBlocksCache: number[] | null;

  constructor(config: CheckpointConfig, writer, schema: string, opts?: CheckpointOptions) {
    this.config = config;
    this.writer = writer;
    this.schema = schema;
    this.entityController = new GqlEntityController(schema);
    this.provider = new Provider({ network: this.config.network as SupportedNetworkName });
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

    const querySchema = new GraphQLObjectType({
      name: 'Query',
      fields: {
        ...entityQueryFields,
        ...coreQueryFields
      }
    });

    return getGraphQL(querySchema, {
      log: this.log.child({ component: 'resolver' }),
      mysql: this.mysql
    });
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

    this.config.sources.forEach(source => {
      start = start === 0 || start > source.start ? source.start : start;
    });
    return nextBlock > start ? nextBlock : start;
  }

  private async getNextBlockNumber(blockNumber: number) {}

  private async next(blockNum: number) {
    const checkpointBlock = await this.getNextCheckpointBlock(blockNum);
    if (checkpointBlock) {
      blockNum = checkpointBlock;
    }

    this.log.debug({ blockNumber: blockNum }, 'next block');

    let block: GetBlockResponse;
    try {
      block = await this.provider.getBlock(blockNum);
    } catch (e) {
      this.log.error({ blockNumber: blockNum, err: e }, 'getting block failed... retrying');

      await Promise.delay(12e3);
      return this.next(blockNum);
    }

    await this.handleBlock(block);

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

  private async handleBlock(block: GetBlockResponse) {
    this.log.info({ blockNumber: block.block_number }, 'handling block');

    // @ts-ignore
    for (const receipt of block.transaction_receipts) {
      await this.handleTx(block, block.transactions[receipt.transaction_index], receipt);
    }

    this.log.debug({ blockNumber: block.block_number }, 'handling block done');
  }

  private async handleTx(block, tx, receipt) {
    this.log.debug({ txIndex: tx.transaction_index }, 'handling transaction');

    for (const source of this.config.sources) {
      let foundContractData = false;
      const contract = validateAndParseAddress(source.contract);

      if (contract === validateAndParseAddress(tx.contract_address)) {
        if (tx.type === 'DEPLOY' && source.deploy_fn) {
          foundContractData = true;
          this.log.info(
            { contract: source.contract, txType: tx.type, handlerFn: source.deploy_fn },
            'found deployment transaction'
          );

          await this.writer[source.deploy_fn]({ source, block, tx, receipt, mysql: this.mysql });
        }
      }

      for (const event of receipt.events) {
        if (contract === validateAndParseAddress(event.from_address)) {
          for (const sourceEvent of source.events) {
            if (`0x${starknetKeccak(sourceEvent.name).toString('hex')}` === event.keys[0]) {
              foundContractData = true;
              this.log.info(
                { contract: source.contract, event: sourceEvent.name, handlerFn: sourceEvent.fn },
                'found contract event'
              );

              await this.writer[sourceEvent.fn]({ source, block, tx, receipt, mysql: this.mysql });
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

    this.log.debug({ txIndex: tx.transaction_index }, 'handling transaction done');
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
