import {
  RangeRequest,
  RangeResponse,
  RangeOptimizationResult,
  OptimizationConfig,
  ErrorType
} from './types';
import { ProfileManager } from './profile-manager';
import { BinarySearchOptimizer } from './binary-search-optimizer';
import { PredictiveCalculator } from './predictive-calculator';
import { CircuitBreaker } from './circuit-breaker';
import { DEFAULT_OPTIMIZATION_CONFIG } from './config';

export class RangeOptimizer {
  private profileManager: ProfileManager;
  private binarySearchOptimizer: BinarySearchOptimizer;
  private predictiveCalculator: PredictiveCalculator;
  private circuitBreaker: CircuitBreaker;
  private config: OptimizationConfig;
  private backoffStates: Map<string, BackoffState> = new Map();

  constructor(config: Partial<OptimizationConfig> = {}) {
    this.config = { ...DEFAULT_OPTIMIZATION_CONFIG, ...config };
    this.profileManager = new ProfileManager(
      this.config.profilePersistenceEnabled,
      this.config.profileStoragePath
    );
    this.binarySearchOptimizer = new BinarySearchOptimizer(this.profileManager);
    this.predictiveCalculator = new PredictiveCalculator(
      this.profileManager,
      this.config.safetyFactor
    );
    this.circuitBreaker = new CircuitBreaker();
  }

  async initialize(): Promise<void> {
    await this.profileManager.initialize();
  }

  async shutdown(): Promise<void> {
    await this.profileManager.saveProfiles();
  }

  async getOptimalRange(request: RangeRequest): Promise<RangeOptimizationResult> {
    const { networkId, estimatedEvents } = request;

    // Check circuit breaker
    if (this.circuitBreaker.isOpen(networkId)) {
      const timeUntilNextAttempt = this.circuitBreaker.getTimeUntilNextAttempt(networkId);
      return {
        suggestedRange: this.config.minRange,
        confidence: 0.1,
        reason: 'Circuit breaker is open',
        shouldBackoff: true,
        backoffDuration: timeUntilNextAttempt
      };
    }

    // Check if we're in a backoff state
    const backoffState = this.backoffStates.get(networkId);
    if (backoffState && Date.now() < backoffState.endTime) {
      return {
        suggestedRange: backoffState.range,
        confidence: 0.3,
        reason: 'In backoff period',
        shouldBackoff: true,
        backoffDuration: backoffState.endTime - Date.now()
      };
    }

    // Use predictive calculator for initial range suggestion
    const currentRange = request.endBlock - request.startBlock;
    return this.predictiveCalculator.calculateOptimalRange(
      networkId,
      estimatedEvents,
      currentRange
    );
  }

  processResponse(request: RangeRequest, response: RangeResponse): RangeOptimizationResult {
    const { networkId } = request;
    const { success, actualEvents, error, rangeUsed } = response;

    // Clear backoff state on success
    if (success) {
      this.backoffStates.delete(networkId);
      this.circuitBreaker.recordSuccess(networkId);
    } else {
      if (error) {
        this.circuitBreaker.recordFailure(networkId, error);
      }
    }

    // Use binary search optimizer to learn from this result
    const result = this.binarySearchOptimizer.optimizeRange(
      networkId,
      rangeUsed,
      success,
      actualEvents,
      error
    );

    // Handle backoff if needed
    if (result.shouldBackoff && result.backoffDuration) {
      this.setBackoffState(networkId, result.suggestedRange, result.backoffDuration);
    }

    return result;
  }

  private setBackoffState(networkId: string, range: number, duration: number): void {
    this.backoffStates.set(networkId, {
      networkId,
      range,
      endTime: Date.now() + duration,
      startTime: Date.now()
    });
  }

  // Error pattern recognition methods
  recognizeErrorPattern(networkId: string, error: Error): ErrorType {
    const message = error.message.toLowerCase();

    // Provider-specific error patterns
    if (message.includes('infura')) {
      if (message.includes('response size exceeded') || message.includes('-32005')) {
        return ErrorType.EVENT_LIMIT;
      }
      if (message.includes('rate limit') || message.includes('429')) {
        return ErrorType.RATE_LIMIT;
      }
    }

    if (message.includes('alchemy')) {
      if (message.includes('compute units') || message.includes('response size')) {
        return ErrorType.EVENT_LIMIT;
      }
    }

    if (message.includes('quicknode')) {
      if (message.includes('rate limit') || message.includes('credits')) {
        return ErrorType.RATE_LIMIT;
      }
    }

    // Generic patterns
    if (message.includes('timeout') || message.includes('504') || message.includes('408')) {
      return ErrorType.TIMEOUT;
    }

    if (message.includes('too many results') || message.includes('query exceeded')) {
      return ErrorType.EVENT_LIMIT;
    }

    if (message.includes('block range') || message.includes('range too large')) {
      return ErrorType.RANGE_LIMIT;
    }

    if (
      message.includes('rate limit') ||
      message.includes('429') ||
      message.includes('throttled')
    ) {
      return ErrorType.RATE_LIMIT;
    }

    return ErrorType.UNKNOWN;
  }

  // Adaptive cooldown calculation
  calculateAdaptiveCooldown(networkId: string, consecutiveFailures: number): number {
    const baseBackoff = this.config.baseBackoffDuration;
    const maxBackoff = this.config.maxBackoffDuration;

    // Exponential backoff with jitter
    const exponentialBackoff = baseBackoff * Math.pow(2, consecutiveFailures - 1);
    const jitter = Math.random() * 0.1 * exponentialBackoff;
    const backoffWithJitter = exponentialBackoff + jitter;

    return Math.min(backoffWithJitter, maxBackoff);
  }

  // Network health monitoring
  getNetworkHealth(networkId: string): NetworkHealth {
    const profile = this.profileManager.getProfile(networkId);
    const circuitBreakerStats = this.circuitBreaker.getStats(networkId);
    const backoffState = this.backoffStates.get(networkId);

    const totalRequests = profile.successfulRequests + profile.failedRequests;
    const successRate = totalRequests > 0 ? profile.successfulRequests / totalRequests : 0;

    let healthStatus: 'healthy' | 'degraded' | 'unhealthy';
    if (circuitBreakerStats.isOpen) {
      healthStatus = 'unhealthy';
    } else if (successRate < 0.7 || backoffState) {
      healthStatus = 'degraded';
    } else {
      healthStatus = 'healthy';
    }

    return {
      networkId,
      healthStatus,
      successRate,
      averageEventsPerBlock: profile.averageEventsPerBlock,
      optimalRange: profile.lastOptimalRange,
      circuitBreakerOpen: circuitBreakerStats.isOpen,
      inBackoff: !!backoffState,
      backoffTimeRemaining: backoffState ? Math.max(0, backoffState.endTime - Date.now()) : 0
    };
  }

  // Management methods
  resetNetwork(networkId: string): void {
    this.profileManager.clearProfile(networkId);
    this.binarySearchOptimizer.resetSearchState(networkId);
    this.circuitBreaker.reset(networkId);
    this.backoffStates.delete(networkId);
  }

  getAllNetworkProfiles() {
    return this.profileManager.getAllProfiles();
  }

  getConfig(): OptimizationConfig {
    return { ...this.config };
  }

  updateConfig(updates: Partial<OptimizationConfig>): void {
    this.config = { ...this.config, ...updates };
    this.predictiveCalculator = new PredictiveCalculator(
      this.profileManager,
      this.config.safetyFactor
    );
  }
}

interface BackoffState {
  networkId: string;
  range: number;
  endTime: number;
  startTime: number;
}

export interface NetworkHealth {
  networkId: string;
  healthStatus: 'healthy' | 'degraded' | 'unhealthy';
  successRate: number;
  averageEventsPerBlock: number;
  optimalRange: number;
  circuitBreakerOpen: boolean;
  inBackoff: boolean;
  backoffTimeRemaining: number;
}
