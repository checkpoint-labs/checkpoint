import { BaseProvider, BlockNotFoundError, ReorgDetectedError } from '../base';
import { getAddress } from '@ethersproject/address';
import { Formatter, Log, Provider, StaticJsonRpcProvider } from '@ethersproject/providers';
import { Interface, LogDescription } from '@ethersproject/abi';
import { keccak256 } from '@ethersproject/keccak256';
import { toUtf8Bytes } from '@ethersproject/strings';
import { CheckpointRecord } from '../../stores/checkpoints';
import { Writer } from './types';
import { ContractSourceConfig } from '../../types';
import { sleep } from '../../utils/helpers';

type BlockWithTransactions = Awaited<ReturnType<Provider['getBlockWithTransactions']>>;
type Transaction = BlockWithTransactions['transactions'][number];
type EventsMap = Record<string, Log[]>;

type GetLogsBlockHashFilter = {
  blockHash: string;
};

type GetLogsBlockRangeFilter = {
  fromBlock: number;
  toBlock: number;
};

const MAX_BLOCKS_PER_REQUEST = 10000;

class CustomJsonRpcError extends Error {
  constructor(message: string, public code: number, public data: any) {
    super(message);
  }
}

export class EvmProvider extends BaseProvider {
  private readonly provider: Provider;
  /**
   * Formatter instance from ethers.js used to format raw responses.
   */
  private readonly formatter = new Formatter();
  private readonly writers: Record<string, Writer>;
  private processedPoolTransactions = new Set();
  private startupLatestBlockNumber: number | undefined;
  private sourceHashes = new Map<string, string>();

  constructor({
    instance,
    log,
    abis,
    writers
  }: ConstructorParameters<typeof BaseProvider>[0] & { writers: Record<string, Writer> }) {
    super({ instance, log, abis });

    this.provider = new StaticJsonRpcProvider(this.instance.config.network_node_url);
    this.writers = writers;
  }

  formatAddresses(addresses: string[]): string[] {
    return addresses.map(address => getAddress(address));
  }

  public async init() {
    this.startupLatestBlockNumber = await this.getLatestBlockNumber();
  }

  async getNetworkIdentifier(): Promise<string> {
    const result = await this.provider.getNetwork();
    return `evm_${result.chainId}`;
  }

  async getLatestBlockNumber(): Promise<number> {
    return this.provider.getBlockNumber();
  }

  async getBlockHash(blockNumber: number) {
    const block = await this.provider.getBlock(blockNumber);
    return block.hash;
  }

  async processBlock(blockNum: number, parentHash: string | null) {
    let block: BlockWithTransactions | null;
    let eventsMap: EventsMap;
    try {
      block = await this.provider.getBlockWithTransactions(blockNum);
    } catch (e) {
      this.log.error({ blockNumber: blockNum, err: e }, 'getting block failed... retrying');
      throw e;
    }

    if (block === null) {
      this.log.info({ blockNumber: blockNum }, 'block not found');
      throw new BlockNotFoundError();
    }

    try {
      eventsMap = await this.getEvents(block.hash);
    } catch (e: unknown) {
      if (e instanceof CustomJsonRpcError && e.code === -32000) {
        this.log.info({ blockNumber: blockNum }, 'block events not found');
        throw new BlockNotFoundError();
      }

      this.log.error({ blockNumber: blockNum, err: e }, 'getting events failed... retrying');
      throw e;
    }

    if (parentHash && block.parentHash !== parentHash) {
      this.log.error({ blockNumber: blockNum }, 'reorg detected');
      throw new ReorgDetectedError();
    }

    await this.handleBlock(block, eventsMap);

    await this.instance.setBlockHash(blockNum, block.hash);

    await this.instance.setLastIndexedBlock(block.number);

    return blockNum + 1;
  }

  private async handleBlock(block: BlockWithTransactions, eventsMap: EventsMap) {
    this.log.info({ blockNumber: block.number }, 'handling block');

    const txsToCheck = block.transactions.filter(
      tx => !this.processedPoolTransactions.has(tx.hash)
    );

    for (const [i, tx] of txsToCheck.entries()) {
      await this.handleTx(block, block.number, i, tx, tx.hash ? eventsMap[tx.hash] || [] : []);
    }

    this.processedPoolTransactions.clear();

    this.log.debug({ blockNumber: block.number }, 'handling block done');
  }

  private async handleTx(
    block: BlockWithTransactions | null,
    blockNumber: number,
    txIndex: number,
    tx: Transaction,
    logs: Log[]
  ) {
    this.log.debug({ txIndex }, 'handling transaction');

    const helpers = await this.instance.getWriterHelpers();

    if (this.instance.config.tx_fn) {
      await this.writers[this.instance.config.tx_fn]({
        blockNumber,
        block,
        tx,
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
          tx,
          rawEvent: event,
          eventIndex,
          helpers
        });
      }
    }

    let lastSources = this.instance.getCurrentSources(blockNumber);
    let shouldUpdateSourcesQueue = false;
    let sourcesQueue = [...lastSources];

    let source: ContractSourceConfig | undefined;
    while ((source = sourcesQueue.shift())) {
      for (const [eventIndex, log] of logs.entries()) {
        if (this.compareAddress(source.contract, log.address)) {
          for (const sourceEvent of source.events) {
            const targetTopic = this.getEventHash(sourceEvent.name);

            if (targetTopic === log.topics[0]) {
              this.log.info(
                { contract: source.contract, event: sourceEvent.name, handlerFn: sourceEvent.fn },
                'found contract event'
              );

              let parsedEvent: LogDescription | undefined;
              if (source.abi && this.abis?.[source.abi]) {
                const iface = new Interface(this.abis[source.abi]);
                try {
                  parsedEvent = iface.parseLog(log);
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
                rawEvent: log,
                event: parsedEvent,
                eventIndex,
                helpers
              });

              shouldUpdateSourcesQueue = true;
            }
          }
        }
      }

      if (shouldUpdateSourcesQueue) {
        const nextSources = this.instance.getCurrentSources(blockNumber);
        sourcesQueue = sourcesQueue.concat(nextSources.slice(lastSources.length));
        lastSources = this.instance.getCurrentSources(blockNumber);
      }
    }

    this.log.debug({ txIndex }, 'handling transaction done');
  }

  private async getEvents(blockHash: string): Promise<EventsMap> {
    const events = await this._getLogs({
      blockHash
    });

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
    }
  ): Promise<Log[]> {
    const params: {
      fromBlock?: string;
      toBlock?: string;
      blockHash?: string;
      address?: string | string[];
    } = {};

    if ('blockHash' in filter) {
      params.blockHash = filter.blockHash;
    }

    if ('fromBlock' in filter) {
      params.fromBlock = `0x${filter.fromBlock.toString(16)}`;
    }

    if ('toBlock' in filter) {
      params.toBlock = `0x${filter.toBlock.toString(16)}`;
    }

    if ('address' in filter) {
      params.address = filter.address;
    }

    const res = await fetch(this.instance.config.network_node_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getLogs',
        params: [params]
      })
    });

    if (!res.ok) {
      throw new Error(`Request failed: ${res.statusText}`);
    }

    const json = await res.json();

    if (json.error) {
      throw new CustomJsonRpcError(json.error.message, json.error.code, json.error.data);
    }

    return Formatter.arrayOf(this.formatter.filterLog.bind(this.formatter))(json.result);
  }

  async getLogs(fromBlock: number, toBlock: number, address: string | string[]) {
    const result = [] as Log[];

    let currentFrom = fromBlock;
    let currentTo = Math.min(toBlock, currentFrom + MAX_BLOCKS_PER_REQUEST);
    while (true) {
      try {
        const logs = await this._getLogs({
          fromBlock: currentFrom,
          toBlock: currentTo,
          address
        });

        result.push(...logs);

        if (currentTo === toBlock) break;
        currentFrom = currentTo + 1;
        currentTo = Math.min(toBlock, currentFrom + MAX_BLOCKS_PER_REQUEST);
      } catch (e: unknown) {
        // Handle Infura response size hint
        if (e instanceof CustomJsonRpcError) {
          if (e.code === -32005) {
            currentFrom = parseInt(e.data.from, 16);
            currentTo = Math.min(parseInt(e.data.to, 16), currentFrom + MAX_BLOCKS_PER_REQUEST);
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

    return result.map(log => ({
      blockNumber: log.blockNumber,
      contractAddress: log.address
    }));
  }

  async getCheckpointsRange(fromBlock: number, toBlock: number): Promise<CheckpointRecord[]> {
    const sourceAddresses = this.instance
      .getCurrentSources(fromBlock)
      .map(source => source.contract);

    const chunks: string[][] = [];
    for (let i = 0; i < sourceAddresses.length; i += 20) {
      chunks.push(sourceAddresses.slice(i, i + 20));
    }

    let events: CheckpointRecord[] = [];
    for (const chunk of chunks) {
      const chunkEvents = await this.getLogs(fromBlock, toBlock, chunk);
      events = events.concat(chunkEvents);
    }

    return events;
  }

  getEventHash(eventName: string) {
    if (!this.sourceHashes.has(eventName)) {
      this.sourceHashes.set(eventName, keccak256(toUtf8Bytes(eventName)));
    }

    return this.sourceHashes.get(eventName) as string;
  }

  compareAddress(a: string, b: string) {
    return a.toLowerCase() === b.toLowerCase();
  }
}
