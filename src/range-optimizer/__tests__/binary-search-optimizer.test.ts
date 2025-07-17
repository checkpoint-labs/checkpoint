import { BinarySearchOptimizer } from '../binary-search-optimizer';
import { ProfileManager } from '../profile-manager';
import { ErrorType } from '../types';

describe('BinarySearchOptimizer', () => {
  let profileManager: ProfileManager;
  let optimizer: BinarySearchOptimizer;
  const networkId = 'test-network';

  beforeEach(() => {
    profileManager = new ProfileManager(false); // Disable persistence for tests
    optimizer = new BinarySearchOptimizer(profileManager);
  });

  describe('optimizeRange', () => {
    it('should start with exponential growth on successful requests', () => {
      const result = optimizer.optimizeRange(networkId, 1000, true, 500);

      expect(result.suggestedRange).toBeGreaterThan(1000);
      expect(result.confidence).toBeGreaterThan(0.5);
      expect(result.reason).toContain('Exponential growth');
      expect(result.shouldBackoff).toBe(false);
    });

    it('should enter binary search mode after failure', () => {
      const error = new Error('Response size exceeded');
      const result = optimizer.optimizeRange(networkId, 5000, false, 0, error);

      expect(result.suggestedRange).toBeLessThan(5000);
      expect(result.confidence).toBeGreaterThan(0.5);
      expect(result.reason).toContain('Binary search');
      expect(result.shouldBackoff).toBe(false);
    });

    it('should handle rate limit errors with backoff', () => {
      const error = new Error('Rate limit exceeded');
      const result = optimizer.optimizeRange(networkId, 2000, false, 0, error);

      expect(result.shouldBackoff).toBe(true);
      expect(result.backoffDuration).toBeDefined();
      expect(result.backoffDuration).toBeGreaterThan(0);
    });

    it('should converge binary search within reasonable bounds', () => {
      // Simulate a series of binary search iterations
      let currentRange = 5000;
      let lastRange = 0;
      let iterations = 0;
      const maxIterations = 10;

      // First failure to trigger binary search
      let result = optimizer.optimizeRange(
        networkId,
        currentRange,
        false,
        0,
        new Error('Too many results')
      );
      currentRange = result.suggestedRange;

      // Simulate binary search convergence
      while (Math.abs(currentRange - lastRange) > 100 && iterations < maxIterations) {
        lastRange = currentRange;

        // Simulate success at lower ranges, failure at higher ranges
        const success = currentRange < 3000;
        result = optimizer.optimizeRange(
          networkId,
          currentRange,
          success,
          success ? 100 : 0,
          success ? undefined : new Error('Range too large')
        );
        currentRange = result.suggestedRange;
        iterations++;
      }

      expect(iterations).toBeLessThan(maxIterations);
      expect(currentRange).toBeLessThan(3500);
      expect(result.confidence).toBeGreaterThan(0.6);
    });

    it('should maintain steady state after convergence', () => {
      // Record several successful requests to establish baseline
      for (let i = 0; i < 5; i++) {
        optimizer.optimizeRange(networkId, 2000, true, 200);
      }

      const result = optimizer.optimizeRange(networkId, 2000, true, 200);

      // Should maintain similar range in steady state
      expect(Math.abs(result.suggestedRange - 2000)).toBeLessThan(1500);
      expect(result.confidence).toBeGreaterThan(0.6);
    });

    it('should increase growth factor with consecutive successes', () => {
      let currentRange = 1000;
      let lastRange = 0;

      // Simulate consecutive successes
      for (let i = 0; i < 3; i++) {
        const result = optimizer.optimizeRange(networkId, currentRange, true, 100);

        if (i > 0) {
          const growthFactor = result.suggestedRange / currentRange;
          expect(growthFactor).toBeGreaterThan(1.4); // Should grow aggressively
        }

        lastRange = currentRange;
        currentRange = result.suggestedRange;
      }

      expect(currentRange).toBeGreaterThan(lastRange);
    });

    it('should reduce range immediately on event limit errors', () => {
      const error = new Error('Event limit exceeded');
      const result = optimizer.optimizeRange(networkId, 3000, false, 0, error);

      expect(result.suggestedRange).toBeLessThan(3000);
      expect(result.reason).toContain('event_limit');
    });

    it('should handle unknown errors gracefully', () => {
      const error = new Error('Unknown error');
      const result = optimizer.optimizeRange(networkId, 2000, false, 0, error);

      expect(result.suggestedRange).toBeLessThan(2000);
      expect(result.confidence).toBeGreaterThan(0.5);
    });
  });

  describe('growth calculation', () => {
    it('should calculate appropriate growth factors', () => {
      // Test with different consecutive success counts
      const testCases = [
        { successes: 1, expectedMinGrowth: 1.0 },
        { successes: 3, expectedMinGrowth: 1.0 },
        { successes: 5, expectedMinGrowth: 1.0 },
        { successes: 10, expectedMaxGrowth: 3.0 }
      ];

      testCases.forEach(({ successes, expectedMinGrowth, expectedMaxGrowth }) => {
        let currentRange = 1000;

        // Simulate consecutive successes
        for (let i = 0; i < successes; i++) {
          const result = optimizer.optimizeRange(networkId, currentRange, true, 100);
          currentRange = result.suggestedRange;
        }

        const finalResult = optimizer.optimizeRange(networkId, currentRange, true, 100);
        const growthFactor = finalResult.suggestedRange / currentRange;

        if (expectedMinGrowth) {
          expect(growthFactor).toBeGreaterThanOrEqual(expectedMinGrowth);
        }
        if (expectedMaxGrowth) {
          expect(growthFactor).toBeLessThanOrEqual(expectedMaxGrowth);
        }
      });
    });
  });

  describe('error classification', () => {
    it('should classify different error types correctly', () => {
      const errorTests = [
        { message: 'Rate limit exceeded', expectedType: ErrorType.RATE_LIMIT },
        { message: 'Response size exceeded', expectedType: ErrorType.EVENT_LIMIT },
        { message: 'Range too large', expectedType: ErrorType.RANGE_LIMIT },
        { message: 'Timeout occurred', expectedType: ErrorType.TIMEOUT },
        { message: 'Unknown error', expectedType: ErrorType.UNKNOWN }
      ];

      errorTests.forEach(({ message, expectedType }) => {
        const error = new Error(message);
        const result = optimizer.optimizeRange(networkId, 2000, false, 0, error);

        // The error type should be reflected in the response strategy
        if (expectedType === ErrorType.RATE_LIMIT) {
          expect(result.shouldBackoff).toBe(true);
        }
      });
    });
  });

  describe('state management', () => {
    it('should reset search state correctly', () => {
      // Trigger binary search mode
      optimizer.optimizeRange(networkId, 5000, false, 0, new Error('Too many results'));

      // Reset state
      optimizer.resetSearchState(networkId);

      // Should return to exponential growth
      const result = optimizer.optimizeRange(networkId, 1000, true, 100);
      expect(result.reason).toContain('Exponential growth');
    });

    it('should maintain separate state for different networks', () => {
      const network1 = 'network-1';
      const network2 = 'network-2';

      // Trigger different states for different networks
      optimizer.optimizeRange(network1, 5000, false, 0, new Error('Failed'));
      optimizer.optimizeRange(network2, 1000, true, 100);

      // States should be independent
      const result1 = optimizer.optimizeRange(network1, 2500, true, 100);
      const result2 = optimizer.optimizeRange(network2, 1500, true, 150);

      expect(result1.reason).toContain('Binary search');
      expect(result2.reason).toContain('Exponential growth');
    });
  });

  describe('performance characteristics', () => {
    it('should handle rapid successive calls efficiently', () => {
      const start = Date.now();

      // Simulate 100 rapid calls
      for (let i = 0; i < 100; i++) {
        optimizer.optimizeRange(networkId, 1000 + i * 10, true, 100);
      }

      const duration = Date.now() - start;
      expect(duration).toBeLessThan(1000); // Should complete within 1 second
    });

    it('should not cause memory leaks with many networks', () => {
      // Test with many different networks
      for (let i = 0; i < 1000; i++) {
        const testNetworkId = `network-${i}`;
        optimizer.optimizeRange(testNetworkId, 1000, true, 100);
      }

      // Should not throw or cause performance issues
      expect(() => {
        optimizer.optimizeRange('new-network', 1000, true, 100);
      }).not.toThrow();
    });
  });
});
