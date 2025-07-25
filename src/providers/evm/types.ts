import { Provider, Log } from '@ethersproject/providers';
import { LogDescription } from '@ethersproject/abi';
import { BaseWriterParams } from '../../types';

export type EventsData = {
  /**
   * Whether the events were preloaded from the cache.
   * If true, it means that events were fetched only for known sources and it might not contain all events from the block.
   * In that case additional logs fetching will be performed for new sources.
   */
  isPreloaded: boolean;
  events: Record<string, Log[]>;
};

export type Block = Awaited<ReturnType<Provider['getBlock']>>;

export type Writer = (
  args: {
    txId: string;
    block: Block | null;
    rawEvent?: Log;
    event?: LogDescription;
  } & BaseWriterParams
) => Promise<void>;
