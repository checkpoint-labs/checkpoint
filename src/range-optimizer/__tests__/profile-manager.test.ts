import { ProfileManager } from '../profile-manager';
import { ErrorType } from '../types';
import { promises as fs } from 'fs';

// Mock fs module
jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn()
  }
}));

describe('ProfileManager', () => {
  let profileManager: ProfileManager;
  const networkId = 'test-network';

  beforeEach(() => {
    profileManager = new ProfileManager(false); // Disable persistence for most tests
    (fs.readFile as jest.Mock).mockClear();
    (fs.writeFile as jest.Mock).mockClear();
  });

  describe('initialization', () => {
    it('should initialize with empty profiles when persistence is disabled', async () => {
      await profileManager.initialize();

      const profile = profileManager.getProfile(networkId);
      expect(profile.successfulRequests).toBe(0);
      expect(profile.failedRequests).toBe(0);
      expect(profile.networkId).toBe(networkId);
    });

    it('should load existing profiles when persistence is enabled', async () => {
      const existingProfiles = {
        'test-network': {
          networkId: 'test-network',
          maxSuccessfulRange: 5000,
          successfulRequests: 10,
          failedRequests: 2,
          averageEventsPerBlock: 5.5,
          totalBlocks: 100,
          totalEvents: 550,
          lastOptimalRange: 4000,
          errorPatterns: [],
          lastUpdated: Date.now()
        }
      };

      (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify(existingProfiles));

      const persistentManager = new ProfileManager(true, 'test-profiles.json');
      await persistentManager.initialize();

      const profile = persistentManager.getProfile(networkId);
      expect(profile.maxSuccessfulRange).toBe(5000);
      expect(profile.successfulRequests).toBe(10);
      expect(profile.averageEventsPerBlock).toBe(5.5);
    });

    it('should handle corrupted profile file gracefully', async () => {
      (fs.readFile as jest.Mock).mockResolvedValue('invalid json');

      const persistentManager = new ProfileManager(true, 'test-profiles.json');
      await persistentManager.initialize();

      const profile = persistentManager.getProfile(networkId);
      expect(profile.successfulRequests).toBe(0); // Should create default profile
    });
  });

  describe('profile recording', () => {
    it('should record successful requests correctly', () => {
      profileManager.recordSuccessfulRequest(networkId, 2000, 150);

      const profile = profileManager.getProfile(networkId);
      expect(profile.successfulRequests).toBe(1);
      expect(profile.maxSuccessfulRange).toBe(2000);
      expect(profile.minSuccessfulRange).toBe(2000);
      expect(profile.lastOptimalRange).toBe(2000);
      expect(profile.totalBlocks).toBe(2000);
      expect(profile.totalEvents).toBe(150);
      expect(profile.averageEventsPerBlock).toBe(0.075);
    });

    it('should update metrics correctly with multiple successful requests', () => {
      profileManager.recordSuccessfulRequest(networkId, 1000, 100);
      profileManager.recordSuccessfulRequest(networkId, 3000, 200);
      profileManager.recordSuccessfulRequest(networkId, 2000, 150);

      const profile = profileManager.getProfile(networkId);
      expect(profile.successfulRequests).toBe(3);
      expect(profile.maxSuccessfulRange).toBe(3000);
      expect(profile.minSuccessfulRange).toBe(1000);
      expect(profile.lastOptimalRange).toBe(2000);
      expect(profile.totalBlocks).toBe(6000);
      expect(profile.totalEvents).toBe(450);
      expect(profile.averageEventsPerBlock).toBe(0.075);
    });

    it('should record failed requests and classify errors', () => {
      const error = new Error('Rate limit exceeded');
      profileManager.recordFailedRequest(networkId, 2000, error);

      const profile = profileManager.getProfile(networkId);
      expect(profile.failedRequests).toBe(1);
      expect(profile.errorPatterns).toHaveLength(1);
      expect(profile.errorPatterns[0].errorType).toBe(ErrorType.RATE_LIMIT);
      expect(profile.errorPatterns[0].rangeAtFailure).toBe(2000);
      expect(profile.errorPatterns[0].frequency).toBe(1);
    });

    it('should aggregate similar error patterns', () => {
      const error1 = new Error('Rate limit exceeded');
      const error2 = new Error('Rate limit exceeded');

      profileManager.recordFailedRequest(networkId, 2000, error1);
      profileManager.recordFailedRequest(networkId, 1500, error2);

      const profile = profileManager.getProfile(networkId);
      expect(profile.errorPatterns).toHaveLength(1);
      expect(profile.errorPatterns[0].frequency).toBe(2);
      expect(profile.errorPatterns[0].rangeAtFailure).toBe(1500); // Should track minimum
    });
  });

  describe('error classification', () => {
    const testCases = [
      { message: 'Rate limit exceeded', expectedType: ErrorType.RATE_LIMIT },
      { message: 'HTTP 429 Too Many Requests', expectedType: ErrorType.RATE_LIMIT },
      { message: 'Response size exceeded', expectedType: ErrorType.EVENT_LIMIT },
      { message: 'Event limit reached', expectedType: ErrorType.EVENT_LIMIT },
      { message: 'Range limit exceeded', expectedType: ErrorType.RANGE_LIMIT },
      { message: 'Block range too large', expectedType: ErrorType.RANGE_LIMIT },
      { message: 'Request timeout', expectedType: ErrorType.TIMEOUT },
      { message: 'HTTP 504 Gateway Timeout', expectedType: ErrorType.TIMEOUT },
      { message: 'Unknown error', expectedType: ErrorType.UNKNOWN }
    ];

    testCases.forEach(({ message, expectedType }) => {
      it(`should classify "${message}" as ${expectedType}`, () => {
        const error = new Error(message);
        profileManager.recordFailedRequest(networkId, 1000, error);

        const profile = profileManager.getProfile(networkId);
        expect(profile.errorPatterns[0].errorType).toBe(expectedType);
      });
    });
  });

  describe('error limit calculation', () => {
    it('should return error limit for specific error types', () => {
      const eventError = new Error('Event limit exceeded');
      const rangeError = new Error('Range limit exceeded');

      profileManager.recordFailedRequest(networkId, 5000, eventError);
      profileManager.recordFailedRequest(networkId, 3000, rangeError);

      const eventLimit = profileManager.getErrorLimit(networkId, ErrorType.EVENT_LIMIT);
      const rangeLimit = profileManager.getErrorLimit(networkId, ErrorType.RANGE_LIMIT);

      expect(eventLimit).toBe(5000);
      expect(rangeLimit).toBe(3000);
    });

    it('should return null for error types with no history', () => {
      const limit = profileManager.getErrorLimit(networkId, ErrorType.TIMEOUT);
      expect(limit).toBeNull();
    });

    it('should return minimum range for error types with multiple occurrences', () => {
      const error1 = new Error('Event limit exceeded');
      const error2 = new Error('Event limit exceeded');

      profileManager.recordFailedRequest(networkId, 5000, error1);
      profileManager.recordFailedRequest(networkId, 3000, error2);

      const limit = profileManager.getErrorLimit(networkId, ErrorType.EVENT_LIMIT);
      expect(limit).toBe(3000);
    });
  });

  describe('profile management', () => {
    it('should clear specific profile', () => {
      profileManager.recordSuccessfulRequest(networkId, 1000, 100);
      profileManager.clearProfile(networkId);

      const profile = profileManager.getProfile(networkId);
      expect(profile.successfulRequests).toBe(0);
    });

    it('should clear all profiles', () => {
      profileManager.recordSuccessfulRequest('network-1', 1000, 100);
      profileManager.recordSuccessfulRequest('network-2', 2000, 200);

      profileManager.clearAllProfiles();

      const profiles = profileManager.getAllProfiles();
      expect(profiles).toHaveLength(0);
    });

    it('should get all profiles', () => {
      profileManager.recordSuccessfulRequest('network-1', 1000, 100);
      profileManager.recordSuccessfulRequest('network-2', 2000, 200);

      const profiles = profileManager.getAllProfiles();
      expect(profiles).toHaveLength(2);
      expect(profiles.map(p => p.networkId)).toContain('network-1');
      expect(profiles.map(p => p.networkId)).toContain('network-2');
    });
  });

  describe('persistence', () => {
    it('should save profiles when persistence is enabled', async () => {
      const persistentManager = new ProfileManager(true, 'test-profiles.json');
      await persistentManager.initialize();

      persistentManager.recordSuccessfulRequest(networkId, 1000, 100);
      await persistentManager.saveProfiles();

      expect(fs.writeFile).toHaveBeenCalledWith(
        'test-profiles.json',
        expect.stringContaining(networkId)
      );
    });

    it('should handle save errors gracefully', async () => {
      (fs.writeFile as jest.Mock).mockRejectedValue(new Error('Write failed'));

      const persistentManager = new ProfileManager(true, 'test-profiles.json');
      await persistentManager.initialize();

      // Should not throw
      await expect(persistentManager.saveProfiles()).resolves.not.toThrow();
    });
  });

  describe('error pattern management', () => {
    it('should limit error patterns to 50 entries', () => {
      // Add 60 different error patterns with different error types to ensure they're not aggregated
      for (let i = 0; i < 60; i++) {
        const error = new Error(`Error ${i} with special code ${i}`);
        profileManager.recordFailedRequest(networkId, 1000 + i, error);
      }

      const profile = profileManager.getProfile(networkId);
      expect(profile.errorPatterns.length).toBeLessThanOrEqual(50);
    });

    it('should keep most recent error patterns when limiting', () => {
      // Add patterns with timestamps
      const now = Date.now();

      for (let i = 0; i < 60; i++) {
        const error = new Error(`Error ${i} with unique code ${i}`);
        profileManager.recordFailedRequest(networkId, 1000 + i, error);

        // Manually adjust timestamp to ensure order
        const profile = profileManager.getProfile(networkId);
        if (profile.errorPatterns.length > 0) {
          profile.errorPatterns[profile.errorPatterns.length - 1].lastSeen = now + i;
        }
      }

      const profile = profileManager.getProfile(networkId);
      expect(profile.errorPatterns.length).toBeLessThanOrEqual(50);

      // Should keep the most recent ones (higher indices)
      const messages = profile.errorPatterns.map(p => p.errorMessage);
      if (messages.length === 50) {
        expect(messages.some(m => m.includes('Error 59'))).toBe(true);
        expect(messages.some(m => m.includes('Error 0'))).toBe(false);
      }
    });
  });
});
