import { CircuitBreakerState, ErrorType } from './types';
import { CIRCUIT_BREAKER_CONFIG } from './config';

export class CircuitBreaker {
  private states: Map<string, CircuitBreakerState> = new Map();
  private config = CIRCUIT_BREAKER_CONFIG;

  isOpen(networkId: string): boolean {
    const state = this.getState(networkId);

    if (state.isOpen) {
      // Check if we should try to close the circuit
      if (Date.now() > state.nextAttemptTime) {
        state.isOpen = false;
        state.failureCount = 0;
        return false;
      }
      return true;
    }

    return false;
  }

  recordSuccess(networkId: string): void {
    const state = this.getState(networkId);
    state.failureCount = 0;
    state.isOpen = false;
    state.lastFailureTime = 0;
    state.nextAttemptTime = 0;
  }

  recordFailure(networkId: string, error: Error): void {
    const state = this.getState(networkId);
    const errorType = this.classifyError(error);

    // Only count certain error types towards circuit breaker
    if (this.shouldCountForCircuitBreaker(errorType)) {
      state.failureCount++;
      state.lastFailureTime = Date.now();

      if (state.failureCount >= this.config.failureThreshold) {
        state.isOpen = true;
        state.nextAttemptTime = Date.now() + this.config.resetTimeout;
      }
    }
  }

  private getState(networkId: string): CircuitBreakerState {
    if (!this.states.has(networkId)) {
      this.states.set(networkId, {
        networkId,
        isOpen: false,
        failureCount: 0,
        lastFailureTime: 0,
        nextAttemptTime: 0,
        resetThreshold: this.config.failureThreshold
      });
    }
    const state = this.states.get(networkId);
    if (!state) {
      throw new Error(`Failed to get circuit breaker state for network ${networkId}`);
    }
    return state;
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

  private shouldCountForCircuitBreaker(errorType: ErrorType): boolean {
    // Only count persistent errors that indicate provider issues
    return (
      errorType === ErrorType.TIMEOUT ||
      errorType === ErrorType.RATE_LIMIT ||
      errorType === ErrorType.UNKNOWN
    );
  }

  getTimeUntilNextAttempt(networkId: string): number {
    const state = this.getState(networkId);
    if (!state.isOpen) return 0;

    return Math.max(0, state.nextAttemptTime - Date.now());
  }

  reset(networkId: string): void {
    this.states.delete(networkId);
  }

  resetAll(): void {
    this.states.clear();
  }

  getStats(networkId: string): CircuitBreakerStats {
    const state = this.getState(networkId);
    return {
      isOpen: state.isOpen,
      failureCount: state.failureCount,
      timeUntilNextAttempt: this.getTimeUntilNextAttempt(networkId),
      lastFailureTime: state.lastFailureTime
    };
  }
}

export interface CircuitBreakerStats {
  isOpen: boolean;
  failureCount: number;
  timeUntilNextAttempt: number;
  lastFailureTime: number;
}
