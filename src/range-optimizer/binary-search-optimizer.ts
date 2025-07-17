import { NetworkProfile, RangeOptimizationResult, ErrorType } from './types';
import { ProfileManager } from './profile-manager';

export class BinarySearchOptimizer {
  private profileManager: ProfileManager;
  private searchStates: Map<string, BinarySearchState> = new Map();

  constructor(profileManager: ProfileManager) {
    this.profileManager = profileManager;
  }

  optimizeRange(
    networkId: string,
    currentRange: number,
    wasSuccessful: boolean,
    events: number,
    error?: Error
  ): RangeOptimizationResult {
    const profile = this.profileManager.getProfile(networkId);
    const searchState = this.getSearchState(networkId);

    if (wasSuccessful) {
      return this.handleSuccessfulRequest(networkId, currentRange, events, profile, searchState);
    } else {
      if (!error) {
        throw new Error('Error parameter is required for failed requests');
      }
      return this.handleFailedRequest(networkId, currentRange, error, profile, searchState);
    }
  }

  private getSearchState(networkId: string): BinarySearchState {
    if (!this.searchStates.has(networkId)) {
      this.searchStates.set(networkId, {
        networkId,
        lowerBound: 10,
        upperBound: 10000,
        isSearching: false,
        lastSuccessfulRange: 1000,
        consecutiveSuccesses: 0,
        consecutiveFailures: 0,
        exponentialPhase: true
      });
    }
    const state = this.searchStates.get(networkId);
    if (!state) {
      throw new Error(`Failed to get search state for network ${networkId}`);
    }
    return state;
  }

  private handleSuccessfulRequest(
    networkId: string,
    currentRange: number,
    events: number,
    profile: NetworkProfile,
    searchState: BinarySearchState
  ): RangeOptimizationResult {
    // Record the successful request
    this.profileManager.recordSuccessfulRequest(networkId, currentRange, events);

    // Update search state
    searchState.lastSuccessfulRange = currentRange;
    searchState.consecutiveSuccesses++;
    searchState.consecutiveFailures = 0;

    if (searchState.isSearching) {
      // We're in binary search mode
      searchState.lowerBound = currentRange;

      if (searchState.upperBound - searchState.lowerBound <= 100) {
        // Search converged, exit binary search mode
        searchState.isSearching = false;
        searchState.exponentialPhase = true;
        return {
          suggestedRange: currentRange,
          confidence: 0.9,
          reason: 'Binary search converged',
          shouldBackoff: false
        };
      }

      // Continue binary search
      const midPoint = Math.floor((searchState.lowerBound + searchState.upperBound) / 2);
      return {
        suggestedRange: midPoint,
        confidence: 0.7,
        reason: 'Binary search in progress',
        shouldBackoff: false
      };
    }

    if (searchState.exponentialPhase) {
      // Exponential growth phase
      const eventDensity = events / currentRange;
      const estimatedLimit = this.estimateProviderLimit(profile, eventDensity);

      if (currentRange < estimatedLimit * 0.8) {
        // Still room to grow exponentially
        const growthFactor = this.calculateGrowthFactor(searchState.consecutiveSuccesses);
        const newRange = Math.min(
          Math.floor(currentRange * growthFactor),
          estimatedLimit,
          searchState.upperBound
        );

        return {
          suggestedRange: newRange,
          confidence: 0.8,
          reason: `Exponential growth (${growthFactor.toFixed(2)}x)`,
          shouldBackoff: false
        };
      } else {
        // Approaching limits, maintain current range
        return {
          suggestedRange: currentRange,
          confidence: 0.9,
          reason: 'Near estimated provider limit',
          shouldBackoff: false
        };
      }
    }

    // Steady state optimization
    return this.optimizeForSteadyState(networkId, currentRange, events, profile);
  }

  private handleFailedRequest(
    networkId: string,
    currentRange: number,
    error: Error,
    profile: NetworkProfile,
    searchState: BinarySearchState
  ): RangeOptimizationResult {
    // Record the failed request
    this.profileManager.recordFailedRequest(networkId, currentRange, error);

    // Update search state
    searchState.consecutiveFailures++;
    searchState.consecutiveSuccesses = 0;
    searchState.upperBound = Math.min(searchState.upperBound, currentRange);

    // Determine error type for response strategy
    const errorType = this.classifyError(error);

    if (errorType === ErrorType.RATE_LIMIT) {
      return {
        suggestedRange: Math.max(currentRange, 100),
        confidence: 0.6,
        reason: 'Rate limit detected',
        shouldBackoff: true,
        backoffDuration: this.calculateBackoffDuration(searchState.consecutiveFailures)
      };
    }

    // Enter or continue binary search mode
    if (!searchState.isSearching) {
      searchState.isSearching = true;
      searchState.exponentialPhase = false;
      searchState.upperBound = currentRange;
      searchState.lowerBound = Math.max(searchState.lowerBound, 10);
    }

    // Calculate new range using binary search
    const midPoint = Math.floor((searchState.lowerBound + searchState.upperBound) / 2);
    const newRange = Math.max(midPoint, 10);

    return {
      suggestedRange: newRange,
      confidence: 0.7,
      reason: `Binary search after ${errorType} error`,
      shouldBackoff: false,
      backoffDuration: undefined
    };
  }

  private optimizeForSteadyState(
    networkId: string,
    currentRange: number,
    events: number,
    profile: NetworkProfile
  ): RangeOptimizationResult {
    const eventDensity = events / currentRange;
    const estimatedLimit = this.estimateProviderLimit(profile, eventDensity);
    const safetyFactor = 0.8;
    const optimalRange = Math.floor(estimatedLimit * safetyFactor);

    if (Math.abs(currentRange - optimalRange) > 100) {
      // Significant difference, adjust gradually
      const adjustment =
        currentRange < optimalRange
          ? Math.min(500, optimalRange - currentRange)
          : Math.max(-500, optimalRange - currentRange);

      return {
        suggestedRange: currentRange + adjustment,
        confidence: 0.8,
        reason: `Steady state optimization (target: ${optimalRange})`,
        shouldBackoff: false
      };
    }

    // Already optimal
    return {
      suggestedRange: currentRange,
      confidence: 0.9,
      reason: 'Already optimal',
      shouldBackoff: false
    };
  }

  private estimateProviderLimit(profile: NetworkProfile, eventDensity: number): number {
    if (profile.averageEventsPerBlock === 0 || eventDensity === 0) {
      return 5000; // Default estimate
    }

    // Estimate based on typical provider limits
    const assumedEventLimit = 10000; // Common RPC provider limit
    const estimatedRange = assumedEventLimit / Math.max(eventDensity, 0.1);

    // Bound the estimate using historical data
    const maxSeen = profile.maxSuccessfulRange || 1000;
    const errorLimit = this.profileManager.getErrorLimit(profile.networkId, ErrorType.EVENT_LIMIT);

    let estimate = Math.floor(Math.min(estimatedRange, maxSeen * 1.5));

    if (errorLimit) {
      estimate = Math.floor(Math.min(estimate, errorLimit * 0.9));
    }

    return Math.max(estimate, 100);
  }

  private calculateGrowthFactor(consecutiveSuccesses: number): number {
    const baseGrowth = 1.5;
    const maxGrowth = 3.0;
    const factor = baseGrowth + consecutiveSuccesses * 0.1;
    return Math.min(factor, maxGrowth);
  }

  private calculateBackoffDuration(consecutiveFailures: number): number {
    const baseBackoff = 1000; // 1 second
    const maxBackoff = 60000; // 1 minute
    const duration = baseBackoff * Math.pow(2, consecutiveFailures - 1);
    return Math.min(duration, maxBackoff);
  }

  private classifyError(error: Error): ErrorType {
    const message = error.message.toLowerCase();

    if (message.includes('rate limit') || message.includes('429')) {
      return ErrorType.RATE_LIMIT;
    }
    if (message.includes('event limit') || message.includes('response size')) {
      return ErrorType.EVENT_LIMIT;
    }
    if (message.includes('range') && message.includes('limit')) {
      return ErrorType.RANGE_LIMIT;
    }
    if (message.includes('timeout') || message.includes('504')) {
      return ErrorType.TIMEOUT;
    }

    return ErrorType.UNKNOWN;
  }

  resetSearchState(networkId: string): void {
    this.searchStates.delete(networkId);
  }

  getSearchStateForInspection(networkId: string): BinarySearchState | undefined {
    return this.searchStates.get(networkId);
  }
}

interface BinarySearchState {
  networkId: string;
  lowerBound: number;
  upperBound: number;
  isSearching: boolean;
  lastSuccessfulRange: number;
  consecutiveSuccesses: number;
  consecutiveFailures: number;
  exponentialPhase: boolean;
}
