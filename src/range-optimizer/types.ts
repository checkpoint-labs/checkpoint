export interface NetworkProfile {
  networkId: string;
  maxSuccessfulRange: number;
  minSuccessfulRange: number;
  averageEventsPerBlock: number;
  totalBlocks: number;
  totalEvents: number;
  successfulRequests: number;
  failedRequests: number;
  lastOptimalRange: number;
  errorPatterns: ErrorPattern[];
  lastUpdated: number;
}

export interface ErrorPattern {
  errorType: ErrorType;
  errorMessage: string;
  rangeAtFailure: number;
  frequency: number;
  lastSeen: number;
}

export enum ErrorType {
  RATE_LIMIT = 'rate_limit',
  EVENT_LIMIT = 'event_limit',
  RANGE_LIMIT = 'range_limit',
  TIMEOUT = 'timeout',
  UNKNOWN = 'unknown'
}

export interface RangeOptimizationResult {
  suggestedRange: number;
  confidence: number;
  reason: string;
  shouldBackoff: boolean;
  backoffDuration?: number;
}

export interface OptimizationConfig {
  initialRange: number;
  maxRange: number;
  minRange: number;
  safetyFactor: number;
  exponentialGrowthFactor: number;
  binarySearchThreshold: number;
  maxBackoffDuration: number;
  baseBackoffDuration: number;
  profilePersistenceEnabled: boolean;
  profileStoragePath?: string;
}

export interface RangeRequest {
  networkId: string;
  startBlock: number;
  endBlock: number;
  estimatedEvents?: number;
}

export interface RangeResponse {
  success: boolean;
  actualEvents: number;
  error?: Error;
  responseTime: number;
  rangeUsed: number;
}

export interface CircuitBreakerState {
  networkId: string;
  isOpen: boolean;
  failureCount: number;
  lastFailureTime: number;
  nextAttemptTime: number;
  resetThreshold: number;
}
