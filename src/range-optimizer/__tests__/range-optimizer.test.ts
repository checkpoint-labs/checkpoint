import { RangeOptimizer } from '../range-optimizer';
import { RangeRequest, RangeResponse, ErrorType } from '../types';

describe('RangeOptimizer', () => {
  let optimizer: RangeOptimizer;
  const networkId = 'test-network';

  beforeEach(() => {
    optimizer = new RangeOptimizer({
      profilePersistenceEnabled: false,
      initialRange: 1000,
      maxRange: 10000,
      minRange: 10,
      safetyFactor: 0.7
    });
  });

  afterEach(async () => {
    await optimizer.shutdown();
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      await expect(optimizer.initialize()).resolves.not.toThrow();
    });

    it('should use default configuration when no config provided', () => {
      const defaultOptimizer = new RangeOptimizer();
      const config = defaultOptimizer.getConfig();

      expect(config.initialRange).toBe(1000);
      expect(config.maxRange).toBe(10000);
      expect(config.minRange).toBe(10);
      expect(config.safetyFactor).toBe(0.7);
    });
  });

  describe('getOptimalRange', () => {
    beforeEach(async () => {
      await optimizer.initialize();
    });

    it('should return conservative range for new network', async () => {
      const request: RangeRequest = {
        networkId,
        startBlock: 1000,
        endBlock: 10000,
        estimatedEvents: 0
      };

      const result = await optimizer.getOptimalRange(request);

      expect(result.suggestedRange).toBe(1000);
      expect(result.confidence).toBeLessThan(0.5);
      expect(result.reason).toContain('No historical data');
      expect(result.shouldBackoff).toBe(false);
    });

    it('should suggest optimal range based on historical data', async () => {
      // Build up some historical data
      const buildupRequests = [
        { range: 1000, events: 100 },
        { range: 2000, events: 200 },
        { range: 3000, events: 300 }
      ];

      for (const { range, events } of buildupRequests) {
        const request: RangeRequest = { networkId, startBlock: 1000, endBlock: 1000 + range };
        const response: RangeResponse = {
          success: true,
          actualEvents: events,
          responseTime: 100,
          rangeUsed: range
        };
        optimizer.processResponse(request, response);
      }

      const request: RangeRequest = {
        networkId,
        startBlock: 5000,
        endBlock: 15000,
        estimatedEvents: 500
      };

      const result = await optimizer.getOptimalRange(request);

      expect(result.suggestedRange).toBeGreaterThan(1000);
      expect(result.confidence).toBeGreaterThan(0.3);
      expect(result.shouldBackoff).toBe(false);
    });

    it('should respect circuit breaker when open', async () => {
      // Trigger circuit breaker by causing multiple failures
      for (let i = 0; i < 6; i++) {
        const request: RangeRequest = { networkId, startBlock: 1000, endBlock: 3000 };
        const response: RangeResponse = {
          success: false,
          actualEvents: 0,
          error: new Error('Timeout'),
          responseTime: 5000,
          rangeUsed: 2000
        };
        optimizer.processResponse(request, response);
      }

      const request: RangeRequest = {
        networkId,
        startBlock: 1000,
        endBlock: 10000
      };

      const result = await optimizer.getOptimalRange(request);

      expect(result.suggestedRange).toBe(10); // Minimum range
      expect(result.shouldBackoff).toBe(true);
      expect(result.reason).toContain('Circuit breaker');
    });
  });

  describe('processResponse', () => {
    beforeEach(async () => {
      await optimizer.initialize();
    });

    it('should handle successful responses', () => {
      const request: RangeRequest = { networkId, startBlock: 1000, endBlock: 3000 };
      const response: RangeResponse = {
        success: true,
        actualEvents: 150,
        responseTime: 500,
        rangeUsed: 2000
      };

      const result = optimizer.processResponse(request, response);

      expect(result.suggestedRange).toBeGreaterThan(2000);
      expect(result.shouldBackoff).toBe(false);
    });

    it('should handle failed responses', () => {
      const request: RangeRequest = { networkId, startBlock: 1000, endBlock: 5000 };
      const response: RangeResponse = {
        success: false,
        actualEvents: 0,
        error: new Error('Response size exceeded'),
        responseTime: 1000,
        rangeUsed: 4000
      };

      const result = optimizer.processResponse(request, response);

      expect(result.suggestedRange).toBeLessThan(4000);
      expect(result.reason).toContain('Binary search');
    });

    it('should set backoff state for rate limit errors', () => {
      const request: RangeRequest = { networkId, startBlock: 1000, endBlock: 3000 };
      const response: RangeResponse = {
        success: false,
        actualEvents: 0,
        error: new Error('Rate limit exceeded'),
        responseTime: 100,
        rangeUsed: 2000
      };

      const result = optimizer.processResponse(request, response);

      expect(result.shouldBackoff).toBe(true);
      expect(result.backoffDuration).toBeGreaterThan(0);
    });
  });

  describe('error pattern recognition', () => {
    it('should recognize provider-specific errors', () => {
      const testCases = [
        { message: 'Infura response size exceeded', expected: ErrorType.EVENT_LIMIT },
        { message: 'Alchemy compute units exceeded', expected: ErrorType.EVENT_LIMIT },
        { message: 'QuickNode rate limit exceeded', expected: ErrorType.RATE_LIMIT },
        { message: 'Request timeout', expected: ErrorType.TIMEOUT },
        { message: 'Block range too large', expected: ErrorType.RANGE_LIMIT },
        { message: 'Unknown error', expected: ErrorType.UNKNOWN }
      ];

      testCases.forEach(({ message, expected }) => {
        const error = new Error(message);
        const result = optimizer.recognizeErrorPattern(networkId, error);
        expect(result).toBe(expected);
      });
    });
  });

  describe('adaptive cooldown', () => {
    it('should calculate exponential backoff with jitter', () => {
      const durations: number[] = [];

      for (let failures = 1; failures <= 5; failures++) {
        const duration = optimizer.calculateAdaptiveCooldown(networkId, failures);
        durations.push(duration);
      }

      // Should increase exponentially
      expect(durations[1]).toBeGreaterThan(durations[0]);
      expect(durations[2]).toBeGreaterThan(durations[1]);
      expect(durations[3]).toBeGreaterThan(durations[2]);

      // Should not exceed maximum
      expect(Math.max(...durations)).toBeLessThanOrEqual(300000);
    });
  });

  describe('network health monitoring', () => {
    beforeEach(async () => {
      await optimizer.initialize();
    });

    it('should report healthy status for successful network', () => {
      // Record successful requests
      for (let i = 0; i < 10; i++) {
        const request: RangeRequest = { networkId, startBlock: 1000, endBlock: 3000 };
        const response: RangeResponse = {
          success: true,
          actualEvents: 100,
          responseTime: 500,
          rangeUsed: 2000
        };
        optimizer.processResponse(request, response);
      }

      const health = optimizer.getNetworkHealth(networkId);

      expect(health.healthStatus).toBe('healthy');
      expect(health.successRate).toBeGreaterThan(0.9);
      expect(health.circuitBreakerOpen).toBe(false);
      expect(health.inBackoff).toBe(false);
    });

    it('should report degraded status for problematic network', () => {
      // Mix of successful and failed requests
      for (let i = 0; i < 5; i++) {
        const request: RangeRequest = { networkId, startBlock: 1000, endBlock: 3000 };
        const response: RangeResponse = {
          success: true,
          actualEvents: 100,
          responseTime: 500,
          rangeUsed: 2000
        };
        optimizer.processResponse(request, response);
      }

      for (let i = 0; i < 3; i++) {
        const request: RangeRequest = { networkId, startBlock: 1000, endBlock: 3000 };
        const response: RangeResponse = {
          success: false,
          actualEvents: 0,
          error: new Error('Failed'),
          responseTime: 1000,
          rangeUsed: 2000
        };
        optimizer.processResponse(request, response);
      }

      const health = optimizer.getNetworkHealth(networkId);

      expect(health.healthStatus).toBe('degraded');
      expect(health.successRate).toBeLessThan(0.7);
    });

    it('should report unhealthy status when circuit breaker is open', () => {
      // Trigger circuit breaker
      for (let i = 0; i < 6; i++) {
        const request: RangeRequest = { networkId, startBlock: 1000, endBlock: 3000 };
        const response: RangeResponse = {
          success: false,
          actualEvents: 0,
          error: new Error('Timeout'),
          responseTime: 5000,
          rangeUsed: 2000
        };
        optimizer.processResponse(request, response);
      }

      const health = optimizer.getNetworkHealth(networkId);

      expect(health.healthStatus).toBe('unhealthy');
      expect(health.circuitBreakerOpen).toBe(true);
    });
  });

  describe('configuration management', () => {
    it('should update configuration correctly', () => {
      const updates = {
        safetyFactor: 0.8,
        maxRange: 15000,
        initialRange: 1500
      };

      optimizer.updateConfig(updates);
      const config = optimizer.getConfig();

      expect(config.safetyFactor).toBe(0.8);
      expect(config.maxRange).toBe(15000);
      expect(config.initialRange).toBe(1500);
    });

    it('should maintain other config values when updating', () => {
      const originalConfig = optimizer.getConfig();

      optimizer.updateConfig({ safetyFactor: 0.9 });
      const updatedConfig = optimizer.getConfig();

      expect(updatedConfig.safetyFactor).toBe(0.9);
      expect(updatedConfig.minRange).toBe(originalConfig.minRange);
      expect(updatedConfig.maxRange).toBe(originalConfig.maxRange);
    });
  });

  describe('network management', () => {
    beforeEach(async () => {
      await optimizer.initialize();
    });

    it('should reset network state correctly', () => {
      // Build up some state
      const request: RangeRequest = { networkId, startBlock: 1000, endBlock: 3000 };
      const response: RangeResponse = {
        success: true,
        actualEvents: 100,
        responseTime: 500,
        rangeUsed: 2000
      };
      optimizer.processResponse(request, response);

      // Reset
      optimizer.resetNetwork(networkId);

      // Should be back to initial state
      const health = optimizer.getNetworkHealth(networkId);
      expect(health.successRate).toBe(0);
      expect(health.optimalRange).toBe(1000);
    });

    it('should handle multiple networks independently', async () => {
      const network1 = 'network-1';
      const network2 = 'network-2';

      // Different patterns for each network
      const request1: RangeRequest = { networkId: network1, startBlock: 1000, endBlock: 3000 };
      const response1: RangeResponse = {
        success: true,
        actualEvents: 100,
        responseTime: 500,
        rangeUsed: 2000
      };
      optimizer.processResponse(request1, response1);

      const request2: RangeRequest = { networkId: network2, startBlock: 1000, endBlock: 3000 };
      const response2: RangeResponse = {
        success: false,
        actualEvents: 0,
        error: new Error('Failed'),
        responseTime: 1000,
        rangeUsed: 2000
      };
      optimizer.processResponse(request2, response2);

      // Should have different health states
      const health1 = optimizer.getNetworkHealth(network1);
      const health2 = optimizer.getNetworkHealth(network2);

      expect(health1.successRate).toBe(1);
      expect(health2.successRate).toBe(0);
    });
  });
});
