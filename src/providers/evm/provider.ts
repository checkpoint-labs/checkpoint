import { BaseProvider, BlockNotFoundError } from '../base';
import { getAddress } from '@ethersproject/address';
import { Log, Provider, StaticJsonRpcProvider } from '@ethersproject/providers';
import { Interface, LogDescription } from '@ethersproject/abi';
import { keccak256 } from '@ethersproject/keccak256';
import { toUtf8Bytes } from '@ethersproject/strings';
import { CheckpointRecord } from '../../stores/checkpoints';
import { Writer } from './types';
import { ContractSourceConfig } from '../../types';

type BlockWithTransactions = Awaited<ReturnType<Provider['getBlockWithTransactions']>>;
type Transaction = BlockWithTransactions['transactions'][number];
type EventsMap = Record<string, Log[]>;

const MAX_BLOCKS_PER_REQUEST = 10000;
export class EvmProvider extends BaseProvider {
  private readonly provider: Provider;
  private readonly writers: Record<string, Writer>;
  private processedPoolTransactions = new Set();
  private startupLatestBlockNumber: number | undefined;

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

  async processBlock(blockNum: number) {
    let block: BlockWithTransactions | null;
    let eventsMap: EventsMap;
    try {
      [block, eventsMap] = await Promise.all([
        this.provider.getBlockWithTransactions(blockNum),
        this.getEvents(blockNum)
      ]);

      if (block === null) {
        this.log.info({ blockNumber: blockNum }, 'block not found');
        throw new BlockNotFoundError();
      }
    } catch (e) {
      this.log.error({ blockNumber: blockNum, err: e }, 'getting block failed... retrying');
      throw e;
    }

    await this.handleBlock(block, eventsMap);

    await this.instance.setLastIndexedBlock(block.number);

    return blockNum + 1;
  }

  async processPool(blockNumber: number) {
    const [block, eventsMap] = await Promise.all([
      this.provider.getBlockWithTransactions('latest'),
      this.getEvents('latest')
    ]);

    await this.handlePool(block, eventsMap, blockNumber);
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

  private async handlePool(
    block: BlockWithTransactions,
    eventsMap: EventsMap,
    blockNumber: number
  ) {
    this.log.info('handling pool');

    const txsToCheck = block.transactions.filter(
      tx => !this.processedPoolTransactions.has(tx.hash)
    );

    for (const [i, tx] of txsToCheck.entries()) {
      await this.handleTx(null, blockNumber, i, tx, tx.hash ? eventsMap[tx.hash] || [] : []);

      this.processedPoolTransactions.add(tx.hash);
    }

    this.log.info('handling pool done');
  }

  private async handleTx(
    block: BlockWithTransactions | null,
    blockNumber: number,
    txIndex: number,
    tx: Transaction,
    logs: Log[]
  ) {
    this.log.debug({ txIndex }, 'handling transaction');

    const writerParams = await this.instance.getWriterParams();

    if (this.instance.config.tx_fn) {
      await this.writers[this.instance.config.tx_fn]({
        blockNumber,
        block,
        tx,
        ...writerParams
      });
    }

    if (this.instance.config.global_events) {
      const globalEventHandlers = this.instance.config.global_events.reduce((handlers, event) => {
        handlers[keccak256(toUtf8Bytes(event.name))] = {
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
          ...writerParams
        });
      }
    }

    let lastSources = this.instance.getCurrentSources(blockNumber);
    const sourcesQueue = [...lastSources];

    let source: ContractSourceConfig | undefined;
    while ((source = sourcesQueue.shift())) {
      const contract = getAddress(source.contract);

      for (const [eventIndex, log] of logs.entries()) {
        if (contract === getAddress(log.address)) {
          for (const sourceEvent of source.events) {
            const targetTopic = keccak256(toUtf8Bytes(sourceEvent.name));

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
                ...writerParams
              });
            }
          }
        }
      }

      const nextSources = this.instance.getCurrentSources(blockNumber);
      const newSources = nextSources.filter(
        nextSource => !lastSources.find(lastSource => lastSource.contract === nextSource.contract)
      );

      sourcesQueue.push(...newSources);
      lastSources = nextSources;
    }

    this.log.debug({ txIndex }, 'handling transaction done');
  }

  private async getEvents(blockNumber: number | 'latest'): Promise<EventsMap> {
    const events = await this.provider.getLogs({
      fromBlock: blockNumber,
      toBlock: blockNumber
    });

    return events.reduce((acc, event) => {
      if (!acc[event.transactionHash]) acc[event.transactionHash] = [];

      acc[event.transactionHash].push(event);

      return acc;
    }, {});
  }

  async getLogs(fromBlock: number, toBlock: number, address: string) {
    const result = [] as Log[];

    let currentFrom = fromBlock;
    let currentTo = Math.min(toBlock, currentFrom + MAX_BLOCKS_PER_REQUEST);
    while (true) {
      try {
        const logs = await this.provider.getLogs({
          fromBlock: currentFrom,
          toBlock: currentTo,
          address
        });

        result.push(...logs);

        if (currentTo === toBlock) break;
        currentFrom = currentTo + 1;
        currentTo = Math.min(toBlock, currentFrom + MAX_BLOCKS_PER_REQUEST);
      } catch (e: any) {
        if (!e.body) throw e;

        const body = JSON.parse(e.body);
        if (body.error.code !== -32005) throw e;

        currentFrom = parseInt(body.error.data.from, 16);
        currentTo = Math.min(
          parseInt(body.error.data.to, 16),
          currentFrom + MAX_BLOCKS_PER_REQUEST
        );
      }
    }

    return result.map(log => ({
      blockNumber: log.blockNumber,
      contractAddress: log.address
    }));
  }

  async getCheckpointsRange(fromBlock: number, toBlock: number): Promise<CheckpointRecord[]> {
    const events: CheckpointRecord[] = [];

    for (const source of this.instance.getCurrentSources(fromBlock)) {
      const addressEvents = await this.getLogs(fromBlock, toBlock, source.contract);
      events.push(...addressEvents);
    }

    return events;
  }
}
