import { CheckpointRecord } from '../../stores/checkpoints';

type CacheEntry = {
  /**
   * Block range for which cache record is valid. This is inclusive on both ends.
   */
  range: [number, number];
  /**
   * Checkpoint records for the source in the given range.
   */
  records: CheckpointRecord[];
};

/**
 * Options for createGetCheckpointsRange.
 */
type Options<T> = {
  /**
   * Function to retrieve sources based on the block number.
   *
   * @param blockNumber Block number.
   * @returns Array of sources.
   */
  sourcesFn: (blockNumber: number) => T[];
  /**
   * Function to extract a key from the source. This key is used for cache.
   *
   * @param source Source.
   * @returns Key.
   */
  keyFn: (source: T) => string;
  /**
   * Function to query checkpoint records for a source within given block range.
   *
   * @param fromBlock Starting block number.
   * @param toBlock Ending block number.
   * @param source The source to query.
   * @returns Promise resolving to an array of CheckpointRecords.
   */
  querySourceFn: (fromBlock: number, toBlock: number, source: T) => Promise<CheckpointRecord[]>;
};

/**
 * Creates a getCheckpointsRange function.
 *
 * This function has a cache to avoid querying the same source for the same block range multiple times.
 * This cache automatically evicts entries outside of the last queried range.
 *
 * @param options
 * @returns A function that retrieves checkpoint records for a given block range.
 */
export function createGetCheckpointsRange<T>(options: Options<T>) {
  const cache = new Map<string, CacheEntry>();

  return async (fromBlock: number, toBlock: number): Promise<CheckpointRecord[]> => {
    const sources = options.sourcesFn(fromBlock);

    let events: CheckpointRecord[] = [];
    for (const source of sources) {
      let sourceEvents: CheckpointRecord[] = [];

      const key = options.keyFn(source);

      const cacheEntry = cache.get(key);
      if (!cacheEntry) {
        const events = await options.querySourceFn(fromBlock, toBlock, source);
        sourceEvents = sourceEvents.concat(events);
      } else {
        const [cacheStart, cacheEnd] = cacheEntry.range;

        const cacheEntries = cacheEntry.records.filter(
          ({ blockNumber }) => blockNumber >= fromBlock && blockNumber <= toBlock
        );

        sourceEvents = sourceEvents.concat(cacheEntries);

        const bottomHalfStart = fromBlock;
        const bottomHalfEnd = Math.min(toBlock, cacheStart - 1);

        const topHalfStart = Math.max(fromBlock, cacheEnd + 1);
        const topHalfEnd = toBlock;

        if (bottomHalfStart <= bottomHalfEnd) {
          const events = await options.querySourceFn(bottomHalfStart, bottomHalfEnd, source);
          sourceEvents = sourceEvents.concat(events);
        }

        if (topHalfStart <= topHalfEnd) {
          const events = await options.querySourceFn(topHalfStart, topHalfEnd, source);
          sourceEvents = sourceEvents.concat(events);
        }
      }

      sourceEvents.sort((a, b) => a.blockNumber - b.blockNumber);

      cache.set(key, {
        range: [fromBlock, toBlock],
        records: sourceEvents
      });

      events = events.concat(sourceEvents);
    }

    return events;
  };
}
