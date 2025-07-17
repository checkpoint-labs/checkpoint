import { NetworkProfile, RangeOptimizationResult } from './types';
import { ProfileManager } from './profile-manager';

export class PredictiveCalculator {
  private profileManager: ProfileManager;
  private safetyFactor: number;

  constructor(profileManager: ProfileManager, safetyFactor = 0.7) {
    this.profileManager = profileManager;
    this.safetyFactor = safetyFactor;
  }

  calculateOptimalRange(
    networkId: string,
    estimatedEvents = 0,
    currentRange = 1000
  ): RangeOptimizationResult {
    const profile = this.profileManager.getProfile(networkId);

    if (profile.successfulRequests === 0) {
      // No historical data, use conservative initial range
      return {
        suggestedRange: 1000,
        confidence: 0.3,
        reason: 'No historical data available',
        shouldBackoff: false
      };
    }

    const calculation = this.performCalculation(profile, estimatedEvents, currentRange);
    return this.validateAndAdjustRange(calculation, profile);
  }

  private performCalculation(
    profile: NetworkProfile,
    estimatedEvents: number,
    currentRange: number
  ): RangeCalculation {
    // Method 1: Event density based calculation
    const eventDensityRange = this.calculateFromEventDensity(profile, estimatedEvents);

    // Method 2: Historical success pattern analysis
    const historicalRange = this.calculateFromHistoricalData(profile);

    // Method 3: Error pattern analysis
    const errorAwareRange = this.calculateFromErrorPatterns(profile);

    // Method 4: Trend analysis
    const trendRange = this.calculateFromTrends(profile, currentRange);

    return {
      eventDensityRange,
      historicalRange,
      errorAwareRange,
      trendRange,
      confidence: this.calculateConfidence(profile)
    };
  }

  private calculateFromEventDensity(profile: NetworkProfile, estimatedEvents: number): number {
    if (profile.averageEventsPerBlock === 0) {
      return 1000; // Default when no event data
    }

    const avgEventsPerBlock = profile.averageEventsPerBlock;
    const estimatedProviderLimit = this.estimateProviderEventLimit(profile);

    if (estimatedEvents > 0) {
      // Use provided estimate
      const blocksNeeded = Math.ceil(estimatedEvents / avgEventsPerBlock);
      return Math.floor(Math.min(blocksNeeded, estimatedProviderLimit / avgEventsPerBlock));
    }

    // Use historical average
    return Math.floor((estimatedProviderLimit * this.safetyFactor) / avgEventsPerBlock);
  }

  private calculateFromHistoricalData(profile: NetworkProfile): number {
    if (profile.maxSuccessfulRange === 0) {
      return 1000;
    }

    // Use the geometric mean of successful ranges, biased toward recent successes
    const recentSuccessRange = profile.lastOptimalRange;
    const maxSuccessRange = profile.maxSuccessfulRange;

    // Weighted average favoring recent success
    const weight = Math.min(profile.successfulRequests / 10, 1);
    return Math.floor(recentSuccessRange * weight + maxSuccessRange * (1 - weight) * 0.8);
  }

  private calculateFromErrorPatterns(profile: NetworkProfile): number {
    let maxSafeRange = profile.maxSuccessfulRange || 10000;

    // Analyze error patterns to find safe upper bounds
    for (const pattern of profile.errorPatterns) {
      if (pattern.frequency > 1) {
        switch (pattern.errorType) {
          case 'event_limit':
            maxSafeRange = Math.floor(Math.min(maxSafeRange, pattern.rangeAtFailure * 0.8));
            break;
          case 'range_limit':
            maxSafeRange = Math.floor(Math.min(maxSafeRange, pattern.rangeAtFailure * 0.9));
            break;
          case 'timeout':
            maxSafeRange = Math.floor(Math.min(maxSafeRange, pattern.rangeAtFailure * 0.7));
            break;
        }
      }
    }

    return Math.max(maxSafeRange, 100);
  }

  private calculateFromTrends(profile: NetworkProfile, currentRange: number): number {
    const successRate =
      profile.successfulRequests / (profile.successfulRequests + profile.failedRequests);

    if (successRate > 0.9) {
      // High success rate, can be more aggressive
      return Math.floor(Math.min(currentRange * 1.2, profile.maxSuccessfulRange * 1.1));
    } else if (successRate < 0.7) {
      // Low success rate, be more conservative
      return Math.floor(Math.max(currentRange * 0.8, profile.minSuccessfulRange));
    }

    // Moderate success rate, maintain current approach
    return currentRange;
  }

  private estimateProviderEventLimit(profile: NetworkProfile): number {
    // Analyze error patterns to estimate provider limits
    const eventLimitErrors = profile.errorPatterns.filter(p => p.errorType === 'event_limit');

    if (eventLimitErrors.length > 0) {
      const estimatedEvents =
        eventLimitErrors
          .map(p => p.rangeAtFailure * profile.averageEventsPerBlock)
          .reduce((sum, events) => sum + events, 0) / eventLimitErrors.length;

      return Math.floor(estimatedEvents * 0.9); // 10% safety margin
    }

    // Common provider limits
    const providerLimits = {
      ethereum: 10000,
      polygon: 3000,
      arbitrum: 10000,
      optimism: 10000,
      avalanche: 2048,
      fantom: 2048,
      binance: 5000
    };

    // Try to infer from network ID
    const networkLower = profile.networkId.toLowerCase();
    for (const [network, limit] of Object.entries(providerLimits)) {
      if (networkLower.includes(network)) {
        return limit;
      }
    }

    return 5000; // Conservative default
  }

  private calculateConfidence(profile: NetworkProfile): number {
    const dataPoints = profile.successfulRequests + profile.failedRequests;

    if (dataPoints === 0) return 0.3;
    if (dataPoints < 5) return 0.4;
    if (dataPoints < 20) return 0.6;
    if (dataPoints < 50) return 0.8;

    return 0.9;
  }

  private validateAndAdjustRange(
    calculation: RangeCalculation,
    profile: NetworkProfile
  ): RangeOptimizationResult {
    const ranges = [
      calculation.eventDensityRange,
      calculation.historicalRange,
      calculation.errorAwareRange,
      calculation.trendRange
    ];

    // Use weighted average with higher weight on more reliable methods
    const weights = [0.4, 0.3, 0.2, 0.1];
    const weightedSum = ranges.reduce((sum, range, index) => sum + range * weights[index], 0);

    let suggestedRange = Math.floor(weightedSum);

    // Apply bounds
    suggestedRange = Math.max(suggestedRange, 10);
    suggestedRange = Math.min(suggestedRange, 50000);

    // Ensure we don't exceed known failure points
    if (profile.maxSuccessfulRange > 0) {
      suggestedRange = Math.floor(Math.min(suggestedRange, profile.maxSuccessfulRange * 1.1));
    }

    return {
      suggestedRange,
      confidence: calculation.confidence,
      reason: this.explainCalculation(calculation, suggestedRange),
      shouldBackoff: false
    };
  }

  private explainCalculation(calculation: RangeCalculation, finalRange: number): string {
    const factors: string[] = [];

    if (calculation.eventDensityRange !== 1000) {
      factors.push(`event density: ${calculation.eventDensityRange}`);
    }
    if (calculation.historicalRange !== 1000) {
      factors.push(`historical: ${calculation.historicalRange}`);
    }
    if (calculation.errorAwareRange !== 1000) {
      factors.push(`error-aware: ${calculation.errorAwareRange}`);
    }

    return `Predictive calculation (${factors.join(', ')}) → ${finalRange}`;
  }
}

interface RangeCalculation {
  eventDensityRange: number;
  historicalRange: number;
  errorAwareRange: number;
  trendRange: number;
  confidence: number;
}
