import { RangeOptimizer, NetworkHealth } from './range-optimizer';
import { RangeRequest, RangeResponse, OptimizationConfig } from './types';
import { DEFAULT_OPTIMIZATION_CONFIG } from './config';

/**
 * Integration adapter for Checkpoint's Container class
 * Provides a seamless interface between the range optimizer and existing Checkpoint architecture
 */
export class CheckpointRangeAdapter {
  private optimizer: RangeOptimizer;
  private networkId: string;
  private enabled = true;

  constructor(networkId: string, config: Partial<OptimizationConfig> = {}) {
    this.networkId = networkId;
    this.optimizer = new RangeOptimizer(config);
  }

  async initialize(): Promise<void> {
    await this.optimizer.initialize();
  }

  async shutdown(): Promise<void> {
    await this.optimizer.shutdown();
  }

  /**
   * Get the optimal range for the next block fetching operation
   * Replaces the existing preloadStep calculation logic
   */
  async getOptimalPreloadRange(
    currentBlock: number,
    targetBlock: number,
    estimatedEvents = 0
  ): Promise<number> {
    if (!this.enabled) {
      return Math.floor(Math.min(1000, targetBlock - currentBlock)); // Fallback to default
    }

    const request: RangeRequest = {
      networkId: this.networkId,
      startBlock: currentBlock,
      endBlock: targetBlock,
      estimatedEvents
    };

    const result = await this.optimizer.getOptimalRange(request);

    // Ensure we don't exceed the available range and return an integer
    return Math.floor(Math.min(result.suggestedRange, targetBlock - currentBlock));
  }

  /**
   * Process the results of a block fetching operation
   * Should be called after each preload attempt
   */
  processPreloadResult(
    startBlock: number,
    endBlock: number,
    success: boolean,
    actualEvents: number,
    error?: Error,
    responseTime = 0
  ): void {
    if (!this.enabled) return;

    const request: RangeRequest = {
      networkId: this.networkId,
      startBlock,
      endBlock
    };

    const response: RangeResponse = {
      success,
      actualEvents,
      error,
      responseTime,
      rangeUsed: endBlock - startBlock
    };

    this.optimizer.processResponse(request, response);
  }

  /**
   * Get network health information for monitoring
   */
  getNetworkHealth(): NetworkHealth {
    return this.optimizer.getNetworkHealth(this.networkId);
  }

  /**
   * Enable/disable the range optimizer
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Check if the optimizer is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Reset the optimizer state for this network
   */
  reset(): void {
    this.optimizer.resetNetwork(this.networkId);
  }

  /**
   * Get the current configuration
   */
  getConfig(): OptimizationConfig {
    return this.optimizer.getConfig();
  }

  /**
   * Update the configuration
   */
  updateConfig(updates: Partial<OptimizationConfig>): void {
    this.optimizer.updateConfig(updates);
  }
}

/**
 * Provider integration for EVM and StarkNet providers
 * Extends the existing provider classes with range optimization
 */
export class ProviderRangeAdapter {
  private optimizer: RangeOptimizer;
  private networkId: string;

  constructor(networkId: string, config: Partial<OptimizationConfig> = {}) {
    this.networkId = networkId;
    this.optimizer = new RangeOptimizer(config);
  }

  async initialize(): Promise<void> {
    await this.optimizer.initialize();
  }

  /**
   * Get optimal range for getLogs/getEvents operations
   */
  async getOptimalLogRange(
    fromBlock: number,
    toBlock: number,
    estimatedEvents = 0
  ): Promise<number> {
    const request: RangeRequest = {
      networkId: this.networkId,
      startBlock: fromBlock,
      endBlock: toBlock,
      estimatedEvents
    };

    const result = await this.optimizer.getOptimalRange(request);
    return Math.floor(Math.min(result.suggestedRange, toBlock - fromBlock));
  }

  /**
   * Process the results of a logs/events query
   */
  processLogResult(
    fromBlock: number,
    toBlock: number,
    success: boolean,
    eventCount: number,
    error?: Error,
    responseTime = 0
  ): void {
    const request: RangeRequest = {
      networkId: this.networkId,
      startBlock: fromBlock,
      endBlock: toBlock
    };

    const response: RangeResponse = {
      success,
      actualEvents: eventCount,
      error,
      responseTime,
      rangeUsed: toBlock - fromBlock
    };

    this.optimizer.processResponse(request, response);
  }

  /**
   * Check if we should retry a failed request
   */
  shouldRetry(error: Error): boolean {
    const errorType = this.optimizer.recognizeErrorPattern(this.networkId, error);
    return errorType !== 'rate_limit'; // Don't retry rate limit errors
  }

  /**
   * Get recommended backoff duration for failed requests
   */
  getBackoffDuration(consecutiveFailures: number): number {
    return this.optimizer.calculateAdaptiveCooldown(this.networkId, consecutiveFailures);
  }

  async shutdown(): Promise<void> {
    await this.optimizer.shutdown();
  }
}

/**
 * Utility functions for easy integration with existing Checkpoint code
 */
export class CheckpointRangeUtils {
  /**
   * Create a range adapter for a specific network
   */
  static createAdapter(
    networkId: string,
    config?: Partial<OptimizationConfig>
  ): CheckpointRangeAdapter {
    return new CheckpointRangeAdapter(networkId, config);
  }

  /**
   * Create a provider adapter for a specific network
   */
  static createProviderAdapter(
    networkId: string,
    config?: Partial<OptimizationConfig>
  ): ProviderRangeAdapter {
    return new ProviderRangeAdapter(networkId, config);
  }

  /**
   * Get default configuration for different network types
   */
  static getNetworkConfig(networkId: string): Partial<OptimizationConfig> {
    const networkLower = networkId.toLowerCase();

    if (networkLower.includes('ethereum') || networkLower.includes('mainnet')) {
      return {
        initialRange: 2000,
        maxRange: 10000,
        safetyFactor: 0.8
      };
    }

    if (networkLower.includes('polygon')) {
      return {
        initialRange: 1000,
        maxRange: 3000,
        safetyFactor: 0.7
      };
    }

    if (networkLower.includes('avalanche') || networkLower.includes('fantom')) {
      return {
        initialRange: 500,
        maxRange: 2000,
        safetyFactor: 0.6
      };
    }

    if (networkLower.includes('starknet')) {
      return {
        initialRange: 1000,
        maxRange: 5000,
        safetyFactor: 0.75
      };
    }

    return DEFAULT_OPTIMIZATION_CONFIG;
  }
}
