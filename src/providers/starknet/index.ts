import { RpcProvider, hash, validateAndParseAddress } from 'starknet';
import { BaseProvider } from '../base';
import { isFullBlock, isDeployTransaction } from '../../types';
import { parseEvent } from './utils';
import type { Abi } from 'starknet';
import type { Block, FullBlock, Transaction, Event, CompleteEvent, EventsMap } from '../../types';

export class StarknetProvider extends BaseProvider {
  private readonly provider: RpcProvider;

  constructor({ instance, log, abis }: ConstructorParameters<typeof BaseProvider>[0]) {
    super({ instance, log, abis });

    this.provider = new RpcProvider({
      nodeUrl: this.instance.config.network_node_url
    });
  }

  async processBlock(blockNum: number) {
    let block: Block;
    let blockEvents: EventsMap;
    try {
      [block, blockEvents] = await Promise.all([
        this.provider.getBlockWithTxs(blockNum),
        this.getEvents(blockNum)
      ]);

      if (!isFullBlock(block) || block.block_number !== blockNum) {
        this.log.error({ blockNumber: blockNum }, 'invalid block');
        throw new Error('invalid block');
      }
    } catch (e) {
      if ((e as Error).message.includes('StarknetErrorCode.BLOCK_NOT_FOUND')) {
        this.log.info({ blockNumber: blockNum }, 'block not found');
      } else {
        this.log.error({ blockNumber: blockNum, err: e }, 'getting block failed... retrying');
      }

      throw e;
    }

    await this.handleBlock(block, blockEvents);

    await this.instance.setLastIndexedBlock(block.block_number);
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

    const writerParams = this.instance.getWriterParams();

    if (this.instance.config.tx_fn) {
      await this.instance.writer[this.instance.config.tx_fn]({
        block,
        tx,
        ...writerParams
      });
    }

    for (const source of this.instance.config.sources || []) {
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

        await this.instance.writer[source.deploy_fn]({
          source,
          block,
          tx,
          ...writerParams
        });
      }

      for (const event of events) {
        if (contract === validateAndParseAddress(event.from_address)) {
          for (const sourceEvent of source.events) {
            if (`0x${hash.starknetKeccak(sourceEvent.name).toString('hex')}` === event.keys[0]) {
              foundContractData = true;
              this.log.info(
                { contract: source.contract, event: sourceEvent.name, handlerFn: sourceEvent.fn },
                'found contract event'
              );

              const completeEvent: CompleteEvent = event;
              if (source.abi && this.abis?.[source.abi]) {
                try {
                  completeEvent.parsed = parseEvent(
                    this.abis?.[source.abi] as Abi,
                    sourceEvent.name,
                    event.data
                  );
                } catch (err) {
                  this.log.warn(
                    { contract: source.contract, txType: tx.type, handlerFn: source.deploy_fn },
                    'failed to parse event'
                  );
                }
              }

              await this.instance.writer[sourceEvent.fn]({
                source,
                block,
                tx,
                event: completeEvent,
                ...writerParams
              });
            }
          }
        }
      }

      if (foundContractData) {
        await this.instance.insertCheckpoints([
          { blockNumber: block.block_number, contractAddress: source.contract }
        ]);
      }
    }

    this.log.debug({ txIndex }, 'handling transaction done');
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
}
