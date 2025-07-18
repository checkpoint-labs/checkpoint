import { RpcProvider, hash, validateAndParseAddress } from 'starknet';
import { BlockWithTxReceipts, SPEC } from '@starknet-io/types-js';
import { BaseProvider, BlockNotFoundError, ReorgDetectedError } from '../base';
import { parseEvent } from './utils';
import { CheckpointRecord } from '../../stores/checkpoints';
import { Block, FullBlock, Event, EventsMap, ParsedEvent, isFullBlock, Writer } from './types';
import { ContractSourceConfig } from '../../types';
import { sleep } from '../../utils/helpers';

class CustomJsonRpcError extends Error {
  constructor(message: string, public code: number, public data: any) {
    super(message);
  }
}

export class StarknetProvider extends BaseProvider {
  private readonly provider: RpcProvider;
  private readonly writers: Record<string, Writer>;
  private seenPoolTransactions = new Set();
  private processedTransactions = new Set();
  private startupLatestBlockNumber: number | undefined;
  private sourceHashes = new Map<string, string>();
  private logsCache = new Map<number, Event[]>();

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
    let block: Block | null = null;
    let blockEvents: EventsMap;
    try {
      const skipBlockFetching = this.instance.opts?.skipBlockFetching ?? false;
      const hasPreloadedBlockEvents = skipBlockFetching && this.logsCache.has(blockNum);

      if (hasPreloadedBlockEvents) {
        block = null;
        blockEvents = await this.getEvents(blockNum);
      } else {
        [block, blockEvents] = await Promise.all([
          this.provider.getBlockWithTxHashes(blockNum),
          this.getEvents(blockNum)
        ]);
      }
    } catch (e) {
      if ((e as Error).message.includes('Block not found')) {
        this.log.info({ blockNumber: blockNum }, 'block not found');
        throw new BlockNotFoundError();
      }

      this.log.error({ blockNumber: blockNum, err: e }, 'getting block failed... retrying');
      throw e;
    }

    if (block && parentHash && block.parent_hash !== parentHash) {
      this.log.error({ blockNumber: blockNum }, 'reorg detected');
      throw new ReorgDetectedError();
    }

    if (block && (!isFullBlock(block) || block.block_number !== blockNum)) {
      this.log.error({ blockNumber: blockNum }, 'invalid block');
      throw new Error('invalid block');
    }

    await this.handleBlock(blockNum, block, blockEvents);

    if (block && isFullBlock(block)) {
      await this.instance.setBlockHash(blockNum, block.block_hash);
    }

    await this.instance.setLastIndexedBlock(blockNum);

    return blockNum + 1;
  }

  async processPool(blockNumber: number) {
    const block = await this.getBlockWithReceipts('pending');
    const receipts = block.transactions
      .map(({ receipt }) => receipt)
      .filter(receipt => !this.seenPoolTransactions.has(receipt.transaction_hash));

    const txIds = receipts.map(receipt => receipt.transaction_hash);
    const eventsMap = receipts.reduce((acc, receipt) => {
      if (receipt === null) return acc;

      acc[receipt.transaction_hash] = receipt.events;
      return acc;
    }, {});

    await this.handlePool(txIds, eventsMap, blockNumber);
  }

  private async handleBlock(blockNumber, block: FullBlock | null, eventsMap: EventsMap) {
    this.log.info({ blockNumber }, 'handling block');

    const blockTransactions = Object.keys(eventsMap);
    const txsToCheck = blockTransactions.filter(txId => !this.seenPoolTransactions.has(txId));

    for (const [i, txId] of txsToCheck.entries()) {
      await this.handleTx(block, blockNumber, i, txId, eventsMap[txId] || []);
    }

    this.seenPoolTransactions.clear();

    this.log.debug({ blockNumber }, 'handling block done');
  }

  private async handlePool(txIds: string[], eventsMap: EventsMap, blockNumber: number) {
    this.log.info('handling pool');

    for (const [i, txId] of txIds.entries()) {
      await this.handleTx(null, blockNumber, i, txId, eventsMap[txId] || []);

      this.seenPoolTransactions.add(txId);
    }

    this.log.info('handling pool done');
  }

  private async handleTx(
    block: FullBlock | null,
    blockNumber: number,
    txIndex: number,
    txId: string,
    events: Event[]
  ) {
    this.log.debug({ txIndex }, 'handling transaction');

    if (this.processedTransactions.has(txId)) {
      this.log.warn({ hash: txId }, 'transaction already processed');
      return;
    }

    let wasTransactionProcessed = false;
    const helpers = await this.instance.getWriterHelpers();

    if (this.instance.config.tx_fn) {
      await this.writers[this.instance.config.tx_fn]({
        blockNumber,
        block,
        txId,
        helpers
      });

      wasTransactionProcessed = true;
    }

    if (this.instance.config.global_events) {
      const globalEventHandlers = this.instance.config.global_events.reduce((handlers, event) => {
        handlers[this.getEventHash(event.name)] = {
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
          txId,
          rawEvent: event,
          eventIndex,
          helpers
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

      for (const [eventIndex, event] of events.entries()) {
        if (contract === validateAndParseAddress(event.from_address)) {
          for (const sourceEvent of source.events) {
            if (this.getEventHash(sourceEvent.name) === event.keys[0]) {
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
                    { contract: source.contract, txId, handlerFn: sourceEvent.fn },
                    'failed to parse event'
                  );
                }
              }

              await this.writers[sourceEvent.fn]({
                source,
                block,
                blockNumber,
                txId,
                rawEvent: event,
                event: parsedEvent,
                eventIndex,
                helpers
              });

              wasTransactionProcessed = true;
            }
          }
        }
      }

      if (wasTransactionProcessed) {
        this.processedTransactions.add(txId);
      }

      if (foundContractData) {
        await this.instance.insertCheckpoints([
          { blockNumber, contractAddress: validateAndParseAddress(source.contract) }
        ]);

        const nextSources = this.instance.getCurrentSources(blockNumber);
        sourcesQueue = sourcesQueue.concat(nextSources.slice(lastSources.length));
        lastSources = this.instance.getCurrentSources(blockNumber);
      }
    }

    this.log.debug({ txIndex }, 'handling transaction done');
  }

  private async getBlockWithReceipts(blockId: SPEC.BLOCK_ID) {
    const res = await fetch(this.instance.config.network_node_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'starknet_getBlockWithReceipts',
        params: [blockId]
      })
    });

    if (!res.ok) {
      throw new Error(`Request failed: ${res.statusText}`);
    }

    const json = await res.json();

    if (json.error) {
      throw new CustomJsonRpcError(json.error.message, json.error.code, json.error.data);
    }

    return json.result as BlockWithTxReceipts;
  }

  private async getEvents(blockNumber: number): Promise<EventsMap> {
    let events: Event[] = [];

    if (this.logsCache.has(blockNumber)) {
      events = this.logsCache.get(blockNumber) || [];
      this.logsCache.delete(blockNumber);
    } else {
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
    }

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

  async getEventsRangeForAddress(
    fromBlock: number,
    toBlock: number,
    address: string,
    eventNames: string[]
  ): Promise<Event[]> {
    let events: Event[] = [];

    let continuationToken: string | undefined;
    do {
      try {
        const result = await this.provider.getEvents({
          from_block: { block_number: fromBlock },
          to_block: { block_number: toBlock },
          address: address,
          keys: [eventNames.map(name => this.getEventHash(name))],
          chunk_size: 1000,
          continuation_token: continuationToken
        });

        events = events.concat(result.events);

        continuationToken = result.continuation_token;
      } catch (e) {
        this.log.error(
          { fromBlock, toBlock, continuationToken, address, err: e },
          'getEvents failed'
        );

        await sleep(5000);
      }
    } while (continuationToken);

    return events;
  }

  async getCheckpointsRange(fromBlock: number, toBlock: number): Promise<CheckpointRecord[]> {
    let events: Event[] = [];

    for (const source of this.instance.getCurrentSources(fromBlock)) {
      const addressEvents = await this.getEventsRangeForAddress(
        fromBlock,
        toBlock,
        source.contract,
        source.events.map(event => event.name)
      );
      events = events.concat(addressEvents);
    }

    for (const log of events) {
      if (!this.logsCache.has(log.block_number)) {
        this.logsCache.set(log.block_number, []);
      }

      this.logsCache.get(log.block_number)?.push(log);
    }

    return events.map(event => ({
      blockNumber: event.block_number,
      contractAddress: validateAndParseAddress(event.from_address)
    }));
  }

  getEventHash(eventName: string) {
    if (!this.sourceHashes.has(eventName)) {
      this.sourceHashes.set(eventName, `0x${hash.starknetKeccak(eventName).toString(16)}`);
    }

    return this.sourceHashes.get(eventName) as string;
  }

  handleNewSourceAdded(): void {
    this.log.info('new source added, clearing logs cache');
    this.logsCache.clear();
  }
}
