import { ProviderRangeAdapter } from '../range-optimizer/checkpoint-integration';
import { Logger } from '../utils/logger';

/**
 * Mixin class that adds range optimization capabilities to existing providers
 * This can be used to extend both EVM and StarkNet providers
 */
export class OptimizedProviderMixin {
  protected rangeAdapter: ProviderRangeAdapter;
  protected log: Logger;
  protected networkId: string;

  constructor(networkId: string, log: Logger) {
    this.networkId = networkId;
    this.log = log;
    this.rangeAdapter = new ProviderRangeAdapter(networkId);
  }

  async initializeRangeOptimizer(): Promise<void> {
    await this.rangeAdapter.initialize();
    this.log.info(`Range optimizer initialized for provider: ${this.networkId}`);
  }

  async shutdownRangeOptimizer(): Promise<void> {
    await this.rangeAdapter.shutdown();
  }

  /**
   * Get optimal range for logs/events fetching
   */
  protected async getOptimalRange(
    fromBlock: number,
    toBlock: number,
    estimatedEvents = 0
  ): Promise<number> {
    return await this.rangeAdapter.getOptimalLogRange(fromBlock, toBlock, estimatedEvents);
  }

  /**
   * Process the results of a logs/events query
   */
  protected processRangeResult(
    fromBlock: number,
    toBlock: number,
    success: boolean,
    eventCount: number,
    error?: Error,
    responseTime = 0
  ): void {
    this.rangeAdapter.processLogResult(
      fromBlock,
      toBlock,
      success,
      eventCount,
      error,
      responseTime
    );
  }

  /**
   * Enhanced error handling with adaptive backoff
   */
  protected async handleRangeError(error: Error, consecutiveFailures: number): Promise<void> {
    if (this.rangeAdapter.shouldRetry(error)) {
      const backoffDuration = this.rangeAdapter.getBackoffDuration(consecutiveFailures);
      this.log.warn(
        { error: error.message, backoff: backoffDuration },
        'Range operation failed, applying backoff'
      );
      await this.sleep(backoffDuration);
    } else {
      throw error; // Don't retry certain errors like rate limits
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Enhanced EVM Provider with range optimization
 */
export class OptimizedEVMProvider extends OptimizedProviderMixin {
  private baseProvider: any; // Reference to the original EVM provider

  constructor(baseProvider: any, networkId: string, log: Logger) {
    super(networkId, log);
    this.baseProvider = baseProvider;
  }

  /**
   * Optimized getLogs implementation with adaptive range sizing
   */
  async getLogs(
    fromBlock: number,
    toBlock: number,
    addresses: string[],
    topics: string[][]
  ): Promise<any[]> {
    let currentBlock = fromBlock;
    const allLogs: any[] = [];
    let consecutiveFailures = 0;

    while (currentBlock <= toBlock) {
      const optimalRange = await this.getOptimalRange(currentBlock, toBlock);
      const endBlock = Math.min(currentBlock + optimalRange, toBlock);

      const startTime = Date.now();
      try {
        const logs = await this.baseProvider._getLogs(currentBlock, endBlock, addresses, topics);
        const responseTime = Date.now() - startTime;

        this.processRangeResult(currentBlock, endBlock, true, logs.length, undefined, responseTime);
        allLogs.push(...logs);
        consecutiveFailures = 0;

        currentBlock = endBlock + 1;
      } catch (error) {
        const responseTime = Date.now() - startTime;
        this.processRangeResult(currentBlock, endBlock, false, 0, error as Error, responseTime);

        consecutiveFailures++;

        // Check if this is a range-related error that requires adjustment
        if (this.isRangeError(error as Error)) {
          // Reduce range and retry
          const reducedRange = Math.max(1, Math.floor(optimalRange / 2));
          const reducedEndBlock = Math.min(currentBlock + reducedRange, toBlock);

          try {
            const logs = await this.baseProvider._getLogs(
              currentBlock,
              reducedEndBlock,
              addresses,
              topics
            );
            this.processRangeResult(currentBlock, reducedEndBlock, true, logs.length);
            allLogs.push(...logs);
            currentBlock = reducedEndBlock + 1;
            consecutiveFailures = 0;
          } catch (retryError) {
            await this.handleRangeError(retryError as Error, consecutiveFailures);
            // Skip this block range if it continues to fail
            currentBlock = endBlock + 1;
          }
        } else {
          await this.handleRangeError(error as Error, consecutiveFailures);
        }
      }
    }

    return allLogs;
  }

  /**
   * Optimized getCheckpointsRange implementation
   */
  async getCheckpointsRange(fromBlock: number, toBlock: number): Promise<any[]> {
    const optimalRange = await this.getOptimalRange(fromBlock, toBlock);
    const endBlock = Math.min(fromBlock + optimalRange, toBlock);

    const startTime = Date.now();
    try {
      const checkpoints = await this.baseProvider.getCheckpointsRange(fromBlock, endBlock);
      const responseTime = Date.now() - startTime;

      this.processRangeResult(
        fromBlock,
        endBlock,
        true,
        checkpoints.length,
        undefined,
        responseTime
      );
      return checkpoints;
    } catch (error) {
      const responseTime = Date.now() - startTime;
      this.processRangeResult(fromBlock, endBlock, false, 0, error as Error, responseTime);
      throw error;
    }
  }

  private isRangeError(error: Error): boolean {
    const message = error.message.toLowerCase();
    return (
      message.includes('response size') ||
      message.includes('range') ||
      message.includes('too many results') ||
      message.includes('query exceeded')
    );
  }
}

/**
 * Enhanced StarkNet Provider with range optimization
 */
export class OptimizedStarkNetProvider extends OptimizedProviderMixin {
  private baseProvider: any; // Reference to the original StarkNet provider

  constructor(baseProvider: any, networkId: string, log: Logger) {
    super(networkId, log);
    this.baseProvider = baseProvider;
  }

  /**
   * Optimized getEvents implementation with adaptive range sizing
   */
  async getEvents(
    fromBlock: number,
    toBlock: number,
    addresses: string[],
    eventTypes: string[]
  ): Promise<any[]> {
    let currentBlock = fromBlock;
    const allEvents: any[] = [];
    let consecutiveFailures = 0;

    while (currentBlock <= toBlock) {
      const optimalRange = await this.getOptimalRange(currentBlock, toBlock);
      const endBlock = Math.min(currentBlock + optimalRange, toBlock);

      const startTime = Date.now();
      try {
        const events = await this.baseProvider.getEvents(
          currentBlock,
          endBlock,
          addresses,
          eventTypes
        );
        const responseTime = Date.now() - startTime;

        this.processRangeResult(
          currentBlock,
          endBlock,
          true,
          events.length,
          undefined,
          responseTime
        );
        allEvents.push(...events);
        consecutiveFailures = 0;

        currentBlock = endBlock + 1;
      } catch (error) {
        const responseTime = Date.now() - startTime;
        this.processRangeResult(currentBlock, endBlock, false, 0, error as Error, responseTime);

        consecutiveFailures++;
        await this.handleRangeError(error as Error, consecutiveFailures);
      }
    }

    return allEvents;
  }

  /**
   * Optimized getCheckpointsRange implementation
   */
  async getCheckpointsRange(fromBlock: number, toBlock: number): Promise<any[]> {
    const optimalRange = await this.getOptimalRange(fromBlock, toBlock);
    const endBlock = Math.min(fromBlock + optimalRange, toBlock);

    const startTime = Date.now();
    try {
      const checkpoints = await this.baseProvider.getCheckpointsRange(fromBlock, endBlock);
      const responseTime = Date.now() - startTime;

      this.processRangeResult(
        fromBlock,
        endBlock,
        true,
        checkpoints.length,
        undefined,
        responseTime
      );
      return checkpoints;
    } catch (error) {
      const responseTime = Date.now() - startTime;
      this.processRangeResult(fromBlock, endBlock, false, 0, error as Error, responseTime);
      throw error;
    }
  }
}
