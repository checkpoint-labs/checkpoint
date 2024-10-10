import { RpcProvider, hash, validateAndParseAddress } from 'starknet';
import { BaseProvider, BlockNotFoundError, ReorgDetectedError } from '../base';
import { parseEvent } from './utils';
import { CheckpointRecord } from '../../stores/checkpoints';
import {
  Block,
  FullBlock,
  Transaction,
  PendingTransaction,
  Event,
  EventsMap,
  ParsedEvent,
  isFullBlock,
  isDeployTransaction,
  Writer
} from './types';
import { ContractSourceConfig } from '../../types';

export class StarknetProvider extends BaseProvider {
  private readonly provider: RpcProvider;
  private readonly writers: Record<string, Writer>;
  private seenPoolTransactions = new Set();
  private processedTransactions = new Set();
  private startupLatestBlockNumber: number | undefined;

  constructor({
    instance,
    log,
    abis,
    writers
  }: ConstructorParameters<typeof BaseProvider>[0] & {
    writers: Record<string, Writer>;
  }) {
    super({ instance, log, abis });

    this.provider = new RpcProvider({
      nodeUrl: this.instance.config.network_node_url
    });
    this.writers = writers;
  }

  public async init() {
    this.startupLatestBlockNumber = await this.getLatestBlockNumber();
  }

  formatAddresses(addresses: string[]): string[] {
    return addresses.map(address => validateAndParseAddress(address));
  }

  async getNetworkIdentifier(): Promise<string> {
    const result = await this.provider.getChainId();
    return `starknet_${result}`;
  }

  async getLatestBlockNumber(): Promise<number> {
    return this.provider.getBlockNumber();
  }

  async getBlockHash(blockNumber: number) {
    const block = await this.provider.getBlock(blockNumber);
    return block.block_hash;
  }

  async processBlock(blockNum: number, parentHash: string | null) {
    let block: Block;
    let blockEvents: EventsMap;
    try {
      [block, blockEvents] = await Promise.all([
        this.provider.getBlockWithTxs(blockNum),
        this.getEvents(blockNum)
      ]);

      if (parentHash && block.parent_hash !== parentHash) {
        this.log.error({ blockNumber: blockNum }, 'reorg detected');
        throw new ReorgDetectedError();
      }

      if (!isFullBlock(block) || block.block_number !== blockNum) {
        this.log.error({ blockNumber: blockNum }, 'invalid block');
        throw new Error('invalid block');
      }
    } catch (e) {
      if ((e as Error).message.includes('Block not found') || e instanceof BlockNotFoundError) {
        this.log.info({ blockNumber: blockNum }, 'block not found');
        throw new BlockNotFoundError();
      }

      this.log.error({ blockNumber: blockNum, err: e }, 'getting block failed... retrying');
      throw e;
    }

    await this.handleBlock(block, blockEvents);

    if (isFullBlock(block)) {
      await this.instance.setBlockHash(blockNum, block.block_hash);
    }

    await this.instance.setLastIndexedBlock(block.block_number);

    return blockNum + 1;
  }

  async processPool(blockNumber: number) {
    const block = await this.provider.getBlockWithTxs('pending');
    const receipts = await Promise.all(
      block.transactions.map(async tx => {
        if (!tx.transaction_hash || this.seenPoolTransactions.has(tx.transaction_hash)) {
          return null;
        }

        try {
          return await this.provider.getTransactionReceipt(tx.transaction_hash);
        } catch (err) {
          this.log.warn(
            { transactionHash: tx.transaction_hash, err },
            'getting transaction receipt failed'
          );
          return null;
        }
      })
    );

    const txsWithReceipts = block.transactions.filter((_, index) => receipts[index] !== null);
    const eventsMap = receipts.reduce((acc, receipt) => {
      if (receipt === null) return acc;

      acc[receipt.transaction_hash] = receipt.events;
      return acc;
    }, {});

    await this.handlePool(txsWithReceipts, eventsMap, blockNumber);
  }

  private async handleBlock(block: FullBlock, eventsMap: EventsMap) {
    this.log.info({ blockNumber: block.block_number }, 'handling block');

    const txsToCheck = block.transactions.filter(
      tx => !this.seenPoolTransactions.has(tx.transaction_hash)
    );

    for (const [i, tx] of txsToCheck.entries()) {
      await this.handleTx(
        block,
        block.block_number,
        i,
        tx,
        tx.transaction_hash ? eventsMap[tx.transaction_hash] || [] : []
      );
    }

    this.seenPoolTransactions.clear();

    this.log.debug({ blockNumber: block.block_number }, 'handling block done');
  }

  private async handlePool(txs: PendingTransaction[], eventsMap: EventsMap, blockNumber: number) {
    this.log.info('handling pool');

    for (const [i, tx] of txs.entries()) {
      await this.handleTx(
        null,
        blockNumber,
        i,
        tx,
        tx.transaction_hash ? eventsMap[tx.transaction_hash] || [] : []
      );

      this.seenPoolTransactions.add(tx.transaction_hash);
    }

    this.log.info('handling pool done');
  }

  private async handleTx(
    block: FullBlock | null,
    blockNumber: number,
    txIndex: number,
    tx: Transaction,
    events: Event[]
  ) {
    this.log.debug({ txIndex }, 'handling transaction');

    if (this.processedTransactions.has(tx.transaction_hash)) {
      this.log.warn({ hash: tx.transaction_hash }, 'transaction already processed');
      return;
    }

    let wasTransactionProcessed = false;
    const writerParams = await this.instance.getWriterParams();

    if (this.instance.config.tx_fn) {
      await this.writers[this.instance.config.tx_fn]({
        blockNumber,
        block,
        tx,
        ...writerParams
      });

      wasTransactionProcessed = true;
    }

    if (this.instance.config.global_events) {
      const globalEventHandlers = this.instance.config.global_events.reduce((handlers, event) => {
        handlers[`0x${hash.starknetKeccak(event.name).toString(16)}`] = {
          name: event.name,
          fn: event.fn
        };
        return handlers;
      }, {});

      for (const [eventIndex, event] of events.entries()) {
        const handler = globalEventHandlers[event.keys[0]];
        if (!handler) continue;

        this.log.info(
          { contract: event.from_address, event: handler.name, handlerFn: handler.fn },
          'found contract event'
        );

        await this.writers[handler.fn]({
          block,
          blockNumber,
          tx,
          rawEvent: event,
          eventIndex,
          ...writerParams
        });

        wasTransactionProcessed = true;
      }
    }

    let lastSources = this.instance.getCurrentSources(blockNumber);
    let sourcesQueue = [...lastSources];

    let source: ContractSourceConfig | undefined;
    while ((source = sourcesQueue.shift())) {
      let foundContractData = false;
      const contract = validateAndParseAddress(source.contract);

      if (
        isDeployTransaction(tx) &&
        source.deploy_fn &&
        contract === validateAndParseAddress(tx.contract_address)
      ) {
        this.log.info(
          { contract: source.contract, txType: tx.type, handlerFn: source.deploy_fn },
          'found deployment transaction'
        );

        await this.writers[source.deploy_fn]({
          source,
          block,
          blockNumber,
          tx,
          ...writerParams
        });

        wasTransactionProcessed = true;
      }

      for (const [eventIndex, event] of events.entries()) {
        if (contract === validateAndParseAddress(event.from_address)) {
          for (const sourceEvent of source.events) {
            if (`0x${hash.starknetKeccak(sourceEvent.name).toString(16)}` === event.keys[0]) {
              foundContractData = true;
              this.log.info(
                { contract: source.contract, event: sourceEvent.name, handlerFn: sourceEvent.fn },
                'found contract event'
              );

              let parsedEvent: ParsedEvent | undefined;
              if (source.abi && this.abis?.[source.abi]) {
                try {
                  parsedEvent = parseEvent(this.abis[source.abi], event);
                } catch (err) {
                  this.log.warn(
                    { contract: source.contract, txType: tx.type, handlerFn: source.deploy_fn },
                    'failed to parse event'
                  );
                }
              }

              await this.writers[sourceEvent.fn]({
                source,
                block,
                blockNumber,
                tx,
                rawEvent: event,
                event: parsedEvent,
                eventIndex,
                ...writerParams
              });

              wasTransactionProcessed = true;
            }
          }
        }
      }

      if (wasTransactionProcessed) {
        this.processedTransactions.add(tx.transaction_hash);
      }

      if (foundContractData) {
        await this.instance.insertCheckpoints([
          { blockNumber, contractAddress: validateAndParseAddress(source.contract) }
        ]);
      }

      const nextSources = this.instance.getCurrentSources(blockNumber);
      const newSources = nextSources.filter(
        nextSource => !lastSources.find(lastSource => lastSource.contract === nextSource.contract)
      );

      sourcesQueue = sourcesQueue.concat(newSources);
      lastSources = nextSources;
    }

    this.log.debug({ txIndex }, 'handling transaction done');
  }

  private async getEvents(blockNumber: number): Promise<EventsMap> {
    let events: Event[] = [];

    let continuationToken: string | undefined;
    do {
      const result = await this.provider.getEvents({
        from_block: { block_number: blockNumber },
        to_block: { block_number: blockNumber },
        chunk_size: 1000,
        continuation_token: continuationToken
      });

      events = events.concat(result.events);

      continuationToken = result.continuation_token;
    } while (continuationToken);

    if (
      events.length === 0 &&
      this.startupLatestBlockNumber &&
      blockNumber > this.startupLatestBlockNumber
    ) {
      throw new BlockNotFoundError();
    }

    return events.reduce((acc, event) => {
      if (!acc[event.transaction_hash]) acc[event.transaction_hash] = [];

      acc[event.transaction_hash].push(event);

      return acc;
    }, {});
  }

  async getCheckpointsRangeForAddress(
    fromBlock: number,
    toBlock: number,
    address: string,
    eventNames: string[]
  ): Promise<CheckpointRecord[]> {
    let events: Event[] = [];

    let continuationToken: string | undefined;
    do {
      const result = await this.provider.getEvents({
        from_block: { block_number: fromBlock },
        to_block: { block_number: toBlock },
        address: address,
        keys: [eventNames.map(name => `0x${hash.starknetKeccak(name).toString(16)}`)],
        chunk_size: 1000,
        continuation_token: continuationToken
      });

      events = events.concat(result.events);

      continuationToken = result.continuation_token;
    } while (continuationToken);

    return events.map(event => ({
      blockNumber: event.block_number,
      contractAddress: validateAndParseAddress(event.from_address)
    }));
  }

  async getCheckpointsRange(fromBlock: number, toBlock: number): Promise<CheckpointRecord[]> {
    let events: CheckpointRecord[] = [];

    for (const source of this.instance.getCurrentSources(fromBlock)) {
      const addressEvents = await this.getCheckpointsRangeForAddress(
        fromBlock,
        toBlock,
        source.contract,
        source.events.map(event => event.name)
      );
      events = events.concat(addressEvents);
    }

    return events;
  }
}
