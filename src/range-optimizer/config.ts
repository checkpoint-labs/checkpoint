import { OptimizationConfig } from './types';

export const DEFAULT_OPTIMIZATION_CONFIG: OptimizationConfig = {
  initialRange: 1000,
  maxRange: 10000,
  minRange: 10,
  safetyFactor: 0.7,
  exponentialGrowthFactor: 2.0,
  binarySearchThreshold: 0.8,
  maxBackoffDuration: 300000, // 5 minutes
  baseBackoffDuration: 1000, // 1 second
  profilePersistenceEnabled: true,
  profileStoragePath: '.checkpoint-profiles.json'
};

export const ERROR_PATTERNS = {
  INFURA_RESPONSE_SIZE: /response size exceeded/i,
  INFURA_RATE_LIMIT: /rate limit exceeded/i,
  ALCHEMY_EVENT_LIMIT: /event limit exceeded/i,
  QUICKNODE_TIMEOUT: /timeout/i,
  GENERIC_RANGE_LIMIT: /range.*limit/i,
  GENERIC_TOO_MANY_RESULTS: /too many results/i
};

export const CIRCUIT_BREAKER_CONFIG = {
  failureThreshold: 5,
  resetTimeout: 60000, // 1 minute
  halfOpenMaxCalls: 3
};
