import { BaseProvider, BlockNotFoundError, ReorgDetectedError } from '../base';
import {
  createPublicClient,
  http,
  PublicClient,
  decodeEventLog,
  DecodeEventLogReturnType,
  formatLog,
  RpcRequestError
} from 'viem';
import { getAddress, keccak256, toBytes } from 'viem/utils';
import { CheckpointRecord } from '../../stores/checkpoints';
import { Block, Writer, Log } from './types';
import { ContractSourceConfig } from '../../types';
import { sleep } from '../../utils/helpers';

type EventsMap = Record<string, Log[]>;

type GetLogsBlockHashFilter = {
  blockHash: string;
};

type GetLogsBlockRangeFilter = {
  fromBlock: number;
  toBlock: number;
};

const MAX_BLOCKS_PER_REQUEST = 10000;

export class EvmProvider extends BaseProvider {
  private readonly client: PublicClient;
  private readonly writers: Record<string, Writer>;
  private processedPoolTransactions = new Set();
  private startupLatestBlockNumber: number | undefined;
  private sourceHashes = new Map<string, string>();
  private logsCache = new Map<number, Log[]>();

  constructor({
    instance,
    log,
    abis,
    writers
  }: ConstructorParameters<typeof BaseProvider>[0] & { writers: Record<string, Writer> }) {
    super({ instance, log, abis });

    this.client = createPublicClient({
      transport: http(this.instance.config.network_node_url)
    });
    this.writers = writers;
  }

  formatAddresses(addresses: string[]): string[] {
    return addresses.map(address => getAddress(address));
  }

  public async init() {
    this.startupLatestBlockNumber = await this.getLatestBlockNumber();
  }

  async getNetworkIdentifier(): Promise<string> {
    const chainId = await this.client.getChainId();
    return `evm_${chainId}`;
  }

  async getLatestBlockNumber(): Promise<number> {
    const num = await this.client.getBlockNumber();
    return Number(num);
  }

  async getBlockHash(blockNumber: number) {
    const block = await this.client.getBlock({ blockNumber: BigInt(blockNumber) });
    return block.hash;
  }

  async processBlock(blockNum: number, parentHash: string | null) {
    let block: Block | null = null;
    let eventsMap: EventsMap;

    const skipBlockFetching = this.instance.opts?.skipBlockFetching ?? false;
    const hasPreloadedBlockEvents = skipBlockFetching && this.logsCache.has(blockNum);

    try {
      if (!hasPreloadedBlockEvents) {
        block = await this.client.getBlock({ blockNumber: BigInt(blockNum) });
      }
    } catch (e) {
      this.log.error({ blockNumber: blockNum, err: e }, 'getting block failed... retrying');
      throw e;
    }

    if (!hasPreloadedBlockEvents && block === null) {
      this.log.info({ blockNumber: blockNum }, 'block not found');
      throw new BlockNotFoundError();
    }

    try {
      eventsMap = await this.getEvents({
        blockNumber: blockNum,
        blockHash: block?.hash ?? null
      });
    } catch (e: unknown) {
      if (e instanceof RpcRequestError && e.code === -32000) {
        this.log.info({ blockNumber: blockNum }, 'block events not found');
        throw new BlockNotFoundError();
      }

      this.log.error({ blockNumber: blockNum, err: e }, 'getting events failed... retrying');
      throw e;
    }

    if (block && parentHash && block.parentHash !== parentHash) {
      this.log.error({ blockNumber: blockNum }, 'reorg detected');
      throw new ReorgDetectedError();
    }

    await this.handleBlock(blockNum, block, eventsMap);

    if (block) {
      await this.instance.setBlockHash(blockNum, block.hash);
    }

    await this.instance.setLastIndexedBlock(blockNum);

    return blockNum + 1;
  }

  private async handleBlock(blockNumber: number, block: Block | null, eventsMap: EventsMap) {
    this.log.info({ blockNumber }, 'handling block');

    const blockTransactions = Object.keys(eventsMap);
    const txsToCheck = blockTransactions.filter(txId => !this.processedPoolTransactions.has(txId));

    for (const [i, txId] of txsToCheck.entries()) {
      await this.handleTx(block, blockNumber, i, txId, eventsMap[txId] || []);
    }

    this.processedPoolTransactions.clear();

    this.log.debug({ blockNumber }, 'handling block done');
  }

  private async handleTx(
    block: Block | null,
    blockNumber: number,
    txIndex: number,
    txId: string,
    logs: Log[]
  ) {
    this.log.debug({ txIndex }, 'handling transaction');

    const helpers = await this.instance.getWriterHelpers();

    if (this.instance.config.tx_fn) {
      await this.writers[this.instance.config.tx_fn]({
        blockNumber,
        block,
        txId,
        helpers
      });
    }

    if (this.instance.config.global_events) {
      const globalEventHandlers = this.instance.config.global_events.reduce((handlers, event) => {
        handlers[this.getEventHash(event.name)] = {
          name: event.name,
          fn: event.fn
        };
        return handlers;
      }, {});

      for (const [eventIndex, event] of logs.entries()) {
        const handler = globalEventHandlers[event.topics[0]];
        if (!handler) continue;

        this.log.info(
          { contract: event.address, event: handler.name, handlerFn: handler.fn },
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
      }
    }

    let lastSources = this.instance.getCurrentSources(blockNumber);
    let sourcesQueue = [...lastSources];

    let source: ContractSourceConfig | undefined;
    while ((source = sourcesQueue.shift())) {
      let foundContractData = false;
      for (const [eventIndex, log] of logs.entries()) {
        if (this.compareAddress(source.contract, log.address)) {
          for (const sourceEvent of source.events) {
            const targetTopic = this.getEventHash(sourceEvent.name);

            if (targetTopic === log.topics[0]) {
              foundContractData = true;
              this.log.info(
                { contract: source.contract, event: sourceEvent.name, handlerFn: sourceEvent.fn },
                'found contract event'
              );

              let parsedEvent: DecodeEventLogReturnType | undefined;
              if (source.abi && this.abis?.[source.abi]) {
                try {
                  parsedEvent = decodeEventLog({
                    abi: this.abis[source.abi],
                    data: log.data,
                    topics: log.topics as [string, ...string[]]
                  });
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
                rawEvent: log,
                event: parsedEvent,
                eventIndex,
                helpers
              });
            }
          }
        }
      }

      if (foundContractData) {
        await this.instance.insertCheckpoints([
          { blockNumber, contractAddress: getAddress(source.contract) }
        ]);

        const nextSources = this.instance.getCurrentSources(blockNumber);
        sourcesQueue = sourcesQueue.concat(nextSources.slice(lastSources.length));
        lastSources = this.instance.getCurrentSources(blockNumber);
      }
    }

    this.log.debug({ txIndex }, 'handling transaction done');
  }

  private async getEvents({
    blockHash,
    blockNumber
  }: {
    blockHash: string | null;
    blockNumber: number;
  }): Promise<EventsMap> {
    let events: Log[] = [];
    if (this.logsCache.has(blockNumber)) {
      events = this.logsCache.get(blockNumber) || [];
      this.logsCache.delete(blockNumber);
    } else {
      if (!blockHash) {
        throw new Error('Block hash is required to fetch logs from network');
      }

      events = await this._getLogs({
        blockHash
      });
    }

    return events.reduce((acc, event) => {
      if (!acc[event.transactionHash]) acc[event.transactionHash] = [];

      acc[event.transactionHash] = acc[event.transactionHash].concat(event);

      return acc;
    }, {});
  }

  /**
   * This method is simpler implementation of getLogs method.
   * This allows using two filters that are not supported in ethers v5:
   * - `blockHash` to get logs for a specific block - if node doesn't know about that block it will fail.
   * - `address` as a single address or an array of addresses.
   * @param filter Logs filter
   */
  private async _getLogs(
    filter: (GetLogsBlockHashFilter | GetLogsBlockRangeFilter) & {
      address?: string | string[];
      topics?: (string | string[])[];
    }
  ): Promise<Log[]> {
    const params: {
      fromBlock?: bigint;
      toBlock?: bigint;
      blockHash?: string;
      address?: string | string[];
      topics?: (string | string[])[];
    } = {};

    if ('blockHash' in filter) {
      params.blockHash = filter.blockHash;
    }

    if ('fromBlock' in filter) {
      params.fromBlock = BigInt(filter.fromBlock);
    }

    if ('toBlock' in filter) {
      params.toBlock = BigInt(filter.toBlock);
    }

    if ('address' in filter) {
      params.address = filter.address;
    }

    if ('topics' in filter) {
      params.topics = filter.topics;
    }

    const logs = await this.client.getLogs(params);

    return logs.map(log => {
      const formatted = formatLog(log);
      return {
        ...formatted,
        blockNumber: formatted.blockNumber ? Number(formatted.blockNumber) : null
      } as Log;
    });
  }

  async getLogs(
    fromBlock: number,
    toBlock: number,
    address: string | string[],
    topics: (string | string[])[] = []
  ): Promise<Log[]> {
    let result = [] as Log[];

    let currentFrom = fromBlock;
    let currentTo = Math.min(toBlock, currentFrom + MAX_BLOCKS_PER_REQUEST);
    while (true) {
      try {
        const logs = await this._getLogs({
          fromBlock: currentFrom,
          toBlock: currentTo,
          address,
          topics
        });

        result = result.concat(logs);

        if (currentTo === toBlock) break;
        currentFrom = currentTo + 1;
        currentTo = Math.min(toBlock, currentFrom + MAX_BLOCKS_PER_REQUEST);
      } catch (e: unknown) {
        // Handle Infura response size hint
        if (e instanceof RpcRequestError) {
          if (e.code === -32005 && typeof e.data === 'object' && e.data) {
            currentFrom = parseInt((e.data as any).from, 16);
            currentTo = Math.min(
              parseInt((e.data as any).to, 16),
              currentFrom + MAX_BLOCKS_PER_REQUEST
            );
            continue;
          }
        }

        this.log.error(
          { fromBlock: currentFrom, toBlock: currentTo, address, err: e },
          'getLogs failed'
        );

        await sleep(5000);
      }
    }

    return result;
  }

  async getCheckpointsRange(fromBlock: number, toBlock: number): Promise<CheckpointRecord[]> {
    const sources = this.instance.getCurrentSources(fromBlock);

    const chunks: ContractSourceConfig[][] = [];
    for (let i = 0; i < sources.length; i += 20) {
      chunks.push(sources.slice(i, i + 20));
    }

    let events: Log[] = [];
    for (const chunk of chunks) {
      const address = chunk.map(source => source.contract);
      const topics = chunk.flatMap(source =>
        source.events.map(event => this.getEventHash(event.name))
      );

      const chunkEvents = await this.getLogs(fromBlock, toBlock, address, [topics]);
      events = events.concat(chunkEvents);
    }

    for (const log of events) {
      if (!this.logsCache.has(log.blockNumber)) {
        this.logsCache.set(log.blockNumber, []);
      }

      this.logsCache.get(log.blockNumber)?.push(log);
    }

    return events.map(log => ({
      blockNumber: log.blockNumber,
      contractAddress: log.address
    }));
  }

  getEventHash(eventName: string) {
    if (!this.sourceHashes.has(eventName)) {
      this.sourceHashes.set(eventName, keccak256(toBytes(eventName)));
    }

    return this.sourceHashes.get(eventName) as string;
  }

  compareAddress(a: string, b: string) {
    return a.toLowerCase() === b.toLowerCase();
  }

  handleNewSourceAdded(): void {
    this.log.info('new source added, clearing logs cache');
    this.logsCache.clear();
  }
}
