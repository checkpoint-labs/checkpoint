import { Block, JsonRpcProvider, Log } from '@ethersproject/providers';
import { Interface } from '@ethersproject/abi';
import { id } from '@ethersproject/hash';
import { BaseProvider } from '../base';
import { ParsedEvent } from '../../types';
import type { Event, EventsMap } from '../../types';

export class EvmProvider extends BaseProvider {
  private readonly provider: JsonRpcProvider;

  constructor({ instance, log, abis }: ConstructorParameters<typeof BaseProvider>[0]) {
    super({ instance, log, abis });

    this.provider = new JsonRpcProvider(this.instance.config.network_node_url);
  }

  async processBlock(blockNum: number) {
    let block: Block;
    let blockEvents: EventsMap;
    try {
      [block, blockEvents] = await Promise.all([
        this.provider.getBlock(blockNum),
        this.getEvents(blockNum)
      ]);
    } catch (e) {
      this.log.error({ blockNumber: blockNum, err: e }, 'getting block failed... retrying');

      throw e;
    }

    await this.handleBlock(block, blockEvents);

    await this.instance.setLastIndexedBlock(block.number);
  }

  private async handleBlock(block: Block, blockEvents: EventsMap) {
    this.log.info({ blockNumber: block.number }, 'handling block');

    for (const [i, tx] of block.transactions.entries()) {
      await this.handleTx(block, i, tx, tx ? blockEvents[tx] || [] : []);
    }

    this.log.debug({ blockNumber: block.number }, 'handling block done');
  }

  private async handleTx(block: Block, txIndex: number, tx: string, events: Event[]) {
    this.log.debug({ txIndex }, 'handling transaction');

    const writerParams = this.instance.getWriterParams();

    if (this.instance.config.tx_fn) {
      await this.instance.writer[this.instance.config.tx_fn]({
        // @ts-ignore
        block,
        // @ts-ignore
        tx,
        ...writerParams
      });
    }

    for (const source of this.instance.config.sources || []) {
      let foundContractData = false;
      const contract = source.contract;

      for (const [eventIndex, event] of events.entries()) {
        // @ts-ignore
        if (contract === event.address) {
          for (const sourceEvent of source.events) {
            if (
              // @TODO convert ABI to compact format to detect event
              // @TODO find a way to handle events that is not as first topic index
              // @ts-ignore
              event.topics?.[0] ===
              id(
                'SpaceCreated(address,address,uint32,uint32,uint32,uint256,uint256,(address,bytes)[],address[],address[])'
              )
            ) {
              foundContractData = true;
              this.log.info(
                { contract: source.contract, event: sourceEvent.name, handlerFn: sourceEvent.fn },
                'found contract event'
              );

              let parsedEvent: ParsedEvent | undefined;
              if (source.abi && this.abis?.[source.abi]) {
                try {
                  const iface = new Interface(this.abis[source.abi]);
                  // @ts-ignore
                  parsedEvent = iface.parseLog(event);
                } catch (err) {
                  this.log.warn(
                    { contract: source.contract, handlerFn: source.deploy_fn },
                    'failed to parse event'
                  );
                }
              }

              await this.instance.writer[sourceEvent.fn]({
                source,
                // @ts-ignore
                block,
                // @ts-ignore
                tx,
                rawEvent: event,
                event: parsedEvent,
                eventIndex,
                ...writerParams
              });
            }
          }
        }
      }

      if (foundContractData) {
        await this.instance.insertCheckpoints([
          { blockNumber: block.number, contractAddress: source.contract }
        ]);
      }
    }

    this.log.debug({ txIndex }, 'handling transaction done');
  }

  private async getEvents(blockNumber: number): Promise<EventsMap> {
    const events: Log[] = [];

    const result = await this.provider.getLogs({
      fromBlock: blockNumber,
      toBlock: blockNumber
    });

    events.push(...result);

    return events.reduce((acc, event: Log) => {
      if (!acc[event.transactionHash]) acc[event.transactionHash] = [];

      acc[event.transactionHash].push(event);

      return acc;
    }, {});
  }
}
