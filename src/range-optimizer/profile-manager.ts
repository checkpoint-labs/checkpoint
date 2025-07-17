import { promises as fs } from 'fs';
import { NetworkProfile, ErrorType } from './types';

export class ProfileManager {
  private profiles: Map<string, NetworkProfile> = new Map();
  private storageEnabled: boolean;
  private storagePath: string;

  constructor(storageEnabled = true, storagePath = '.checkpoint-profiles.json') {
    this.storageEnabled = storageEnabled;
    this.storagePath = storagePath;
  }

  async initialize(): Promise<void> {
    if (this.storageEnabled) {
      await this.loadProfiles();
    }
  }

  private async loadProfiles(): Promise<void> {
    try {
      const data = await fs.readFile(this.storagePath, 'utf8');
      const profilesData = JSON.parse(data);

      for (const [networkId, profile] of Object.entries(profilesData)) {
        this.profiles.set(networkId, profile as NetworkProfile);
      }
    } catch (error) {
      // File doesn't exist or is corrupted, start with empty profiles
      this.profiles.clear();
    }
  }

  async saveProfiles(): Promise<void> {
    if (!this.storageEnabled) return;

    try {
      const profilesData = Object.fromEntries(this.profiles);
      await fs.writeFile(this.storagePath, JSON.stringify(profilesData, null, 2));
    } catch (error) {
      console.warn('Failed to save network profiles:', error);
    }
  }

  getProfile(networkId: string): NetworkProfile {
    return this.profiles.get(networkId) || this.createDefaultProfile(networkId);
  }

  private createDefaultProfile(networkId: string): NetworkProfile {
    return {
      networkId,
      maxSuccessfulRange: 0,
      minSuccessfulRange: Number.MAX_SAFE_INTEGER,
      averageEventsPerBlock: 0,
      totalBlocks: 0,
      totalEvents: 0,
      successfulRequests: 0,
      failedRequests: 0,
      lastOptimalRange: 1000,
      errorPatterns: [],
      lastUpdated: Date.now()
    };
  }

  updateProfile(networkId: string, updates: Partial<NetworkProfile>): void {
    const profile = this.getProfile(networkId);
    const updatedProfile = { ...profile, ...updates, lastUpdated: Date.now() };
    this.profiles.set(networkId, updatedProfile);
  }

  recordSuccessfulRequest(networkId: string, range: number, events: number): void {
    const profile = this.getProfile(networkId);

    // Update success metrics
    profile.successfulRequests++;
    profile.maxSuccessfulRange = Math.max(profile.maxSuccessfulRange, range);
    profile.minSuccessfulRange = Math.min(profile.minSuccessfulRange, range);
    profile.lastOptimalRange = range;

    // Update event density metrics
    profile.totalBlocks += range;
    profile.totalEvents += events;
    profile.averageEventsPerBlock = profile.totalEvents / profile.totalBlocks;

    profile.lastUpdated = Date.now();
    this.profiles.set(networkId, profile);
  }

  recordFailedRequest(networkId: string, range: number, error: Error): void {
    const profile = this.getProfile(networkId);

    profile.failedRequests++;

    // Analyze error pattern
    const errorType = this.classifyError(error);
    this.updateErrorPattern(profile, errorType, error.message, range);

    profile.lastUpdated = Date.now();
    this.profiles.set(networkId, profile);
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
    if (message.includes('block range') && message.includes('large')) {
      return ErrorType.RANGE_LIMIT;
    }
    if (message.includes('timeout') || message.includes('504')) {
      return ErrorType.TIMEOUT;
    }

    return ErrorType.UNKNOWN;
  }

  private updateErrorPattern(
    profile: NetworkProfile,
    errorType: ErrorType,
    message: string,
    range: number
  ): void {
    const existingPattern = profile.errorPatterns.find(
      p => p.errorType === errorType && this.isSimilarError(p.errorMessage, message)
    );

    if (existingPattern) {
      existingPattern.frequency++;
      existingPattern.rangeAtFailure = Math.min(existingPattern.rangeAtFailure, range);
      existingPattern.lastSeen = Date.now();
    } else {
      profile.errorPatterns.push({
        errorType,
        errorMessage: message,
        rangeAtFailure: range,
        frequency: 1,
        lastSeen: Date.now()
      });

      // Keep only the most recent 50 error patterns
      if (profile.errorPatterns.length > 50) {
        profile.errorPatterns.sort((a, b) => b.lastSeen - a.lastSeen);
        profile.errorPatterns = profile.errorPatterns.slice(0, 50);
      }
    }
  }

  private isSimilarError(error1: string, error2: string): boolean {
    // Simple similarity check - could be enhanced with fuzzy matching
    const normalized1 = error1.toLowerCase().replace(/\d+/g, '');
    const normalized2 = error2.toLowerCase().replace(/\d+/g, '');
    return normalized1 === normalized2;
  }

  getErrorLimit(networkId: string, errorType: ErrorType): number | null {
    const profile = this.getProfile(networkId);
    const patterns = profile.errorPatterns.filter(p => p.errorType === errorType);

    if (patterns.length === 0) return null;

    // Return the minimum range that caused this error type
    return Math.min(...patterns.map(p => p.rangeAtFailure));
  }

  getAllProfiles(): NetworkProfile[] {
    return Array.from(this.profiles.values());
  }

  clearProfile(networkId: string): void {
    this.profiles.delete(networkId);
  }

  clearAllProfiles(): void {
    this.profiles.clear();
  }
}
