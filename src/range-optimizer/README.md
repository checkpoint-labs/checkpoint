# Checkpoint Range Optimizer

An adaptive block range optimization system for Checkpoint (https://github.com/checkpoint-labs/checkpoint), a TypeScript blockchain indexing library.

## Overview

The Range Optimizer replaces Checkpoint's hardcoded event limit approach with an intelligent, self-optimizing system that:

- **Adapts to provider limits**: Automatically discovers and respects different RPC provider capabilities
- **Optimizes for performance**: Uses binary search and predictive algorithms to find optimal block ranges
- **Handles errors gracefully**: Recognizes different error patterns and responds appropriately
- **Learns from experience**: Maintains network profiles to improve performance over time
- **Provides monitoring**: Offers network health insights and performance metrics

## Features

### 1. Adaptive Binary Search Algorithm
- **Exponential growth**: Starts conservative and grows exponentially on success
- **Binary search**: Efficiently finds optimal range when limits are hit
- **Convergence**: Automatically finds the sweet spot between performance and reliability

### 2. Per-Network Profiling
- **Persistent storage**: Saves network profiles across restarts
- **Event density tracking**: Learns average events per block for each network
- **Success/failure patterns**: Tracks historical performance data
- **Provider-specific optimization**: Adapts to different RPC provider characteristics

### 3. Predictive Range Calculation
- **Event density analysis**: Calculates optimal ranges based on historical event patterns
- **Provider limit estimation**: Infers provider capabilities from error patterns
- **Safety factors**: Applies configurable safety margins to prevent failures

### 4. Error Pattern Recognition
- **Provider-specific errors**: Recognizes Infura, Alchemy, QuickNode error patterns
- **Error classification**: Categorizes errors as rate limits, event limits, range limits, etc.
- **Adaptive responses**: Handles different error types with appropriate strategies

### 5. Adaptive Cooldown & Recovery
- **Exponential backoff**: Implements intelligent retry strategies
- **Circuit breaker**: Prevents cascading failures with automatic recovery
- **Gradual recovery**: Slowly increases ranges after failure periods

## Installation

The Range Optimizer is integrated into Checkpoint. To enable it:

```typescript
import { CheckpointRangeUtils } from './range-optimizer';

// Enable for your indexer
const config = {
  // ... your existing Checkpoint config
  rangeOptimization: true, // Enable range optimization
  rangeOptimizationConfig: {
    safetyFactor: 0.8,
    maxRange: 10000,
    initialRange: 1000
  }
};
```

## Configuration Options

```typescript
interface OptimizationConfig {
  // Basic range settings
  initialRange: number;          // Starting range (default: 1000)
  maxRange: number;             // Maximum allowed range (default: 10000) 
  minRange: number;             // Minimum allowed range (default: 10)
  
  // Safety and performance
  safetyFactor: number;         // Safety margin 0-1 (default: 0.7)
  exponentialGrowthFactor: number; // Growth rate (default: 2.0)
  binarySearchThreshold: number;   // When to switch to binary search (default: 0.8)
  
  // Error handling
  maxBackoffDuration: number;   // Max backoff time in ms (default: 300000)
  baseBackoffDuration: number;  // Base backoff time in ms (default: 1000)
  
  // Persistence
  profilePersistenceEnabled: boolean; // Save profiles to disk (default: true)
  profileStoragePath?: string;       // Storage file path (default: .checkpoint-profiles.json)
}
```

## Network-Specific Configuration

The optimizer includes built-in configurations for major networks:

```typescript
// Ethereum mainnet
const ethereumConfig = {
  initialRange: 2000,
  maxRange: 10000,
  safetyFactor: 0.8
};

// Polygon
const polygonConfig = {
  initialRange: 1000,
  maxRange: 3000,
  safetyFactor: 0.7
};

// Avalanche/Fantom
const avaxConfig = {
  initialRange: 500,
  maxRange: 2000,
  safetyFactor: 0.6
};
```

## Usage Examples

### Basic Integration

```typescript
import { CheckpointRangeAdapter } from './range-optimizer';

class MyContainer {
  private rangeAdapter: CheckpointRangeAdapter;
  
  constructor(networkId: string) {
    this.rangeAdapter = new CheckpointRangeAdapter(networkId);
  }
  
  async initialize() {
    await this.rangeAdapter.initialize();
  }
  
  async preloadBlocks(currentBlock: number, targetBlock: number) {
    // Get optimal range
    const optimalRange = await this.rangeAdapter.getOptimalPreloadRange(
      currentBlock, 
      targetBlock, 
      0 // estimated events
    );
    
    const endBlock = Math.min(currentBlock + optimalRange, targetBlock);
    
    try {
      const checkpoints = await this.provider.getCheckpointsRange(currentBlock, endBlock);
      
      // Record success
      this.rangeAdapter.processPreloadResult(
        currentBlock, 
        endBlock, 
        true, 
        checkpoints.length
      );
      
      return checkpoints;
    } catch (error) {
      // Record failure
      this.rangeAdapter.processPreloadResult(
        currentBlock, 
        endBlock, 
        false, 
        0, 
        error
      );
      throw error;
    }
  }
}
```

### Provider Integration

```typescript
import { OptimizedEVMProvider } from './providers/optimized-provider';

class MyEVMProvider extends OptimizedEVMProvider {
  async fetchLogs(fromBlock: number, toBlock: number) {
    // The optimized provider automatically handles range optimization
    return await this.getLogs(fromBlock, toBlock, addresses, topics);
  }
}
```

### Monitoring Network Health

```typescript
import { RangeOptimizer } from './range-optimizer';

const optimizer = new RangeOptimizer();
await optimizer.initialize();

// Get network health
const health = optimizer.getNetworkHealth('ethereum');
console.log(`Network: ${health.networkId}`);
console.log(`Status: ${health.healthStatus}`); // healthy, degraded, unhealthy
console.log(`Success Rate: ${health.successRate}`);
console.log(`Optimal Range: ${health.optimalRange}`);
console.log(`Circuit Breaker: ${health.circuitBreakerOpen}`);
```

## Error Handling

The optimizer recognizes and handles various error patterns:

### Provider-Specific Errors
- **Infura**: Response size exceeded (-32005), Rate limits
- **Alchemy**: Compute units exceeded, Event limits
- **QuickNode**: Rate limits, Credit limits
- **Generic**: Timeouts, Range limits, Unknown errors

### Error Response Strategies
- **Rate Limits**: Exponential backoff with circuit breaker
- **Event Limits**: Binary search to find optimal range
- **Range Limits**: Immediate range reduction
- **Timeouts**: Gradual range reduction with retry

## Performance Characteristics

### Optimization Timeline
1. **Initial Phase**: Conservative 1000-block ranges
2. **Growth Phase**: Exponential increase on success (1.5x - 3x)
3. **Search Phase**: Binary search when limits are hit
4. **Steady State**: Maintain optimal range with minor adjustments

### Convergence Speed
- **Fast networks**: 5-10 requests to find optimal range
- **Slow networks**: 10-20 requests for convergence
- **Error-prone networks**: Continuous adaptation

### Memory Usage
- **Per network**: ~1KB profile data
- **100 networks**: ~100KB total
- **Error patterns**: Limited to 50 per network

## Monitoring & Debugging

### Network Health Status
- **Healthy**: >90% success rate, no circuit breaker
- **Degraded**: 70-90% success rate or in backoff
- **Unhealthy**: <70% success rate or circuit breaker open

### Logging Integration
The optimizer integrates with Checkpoint's logging system:

```typescript
// Enable debug logging
const logger = new Logger({ level: 'debug' });

// View optimization decisions
logger.debug({
  networkId: 'ethereum',
  currentRange: 2000,
  suggestedRange: 3000,
  reason: 'Exponential growth (2.0x)'
});
```

### Profile Inspection
```typescript
// Get all network profiles
const profiles = optimizer.getAllNetworkProfiles();

profiles.forEach(profile => {
  console.log(`Network: ${profile.networkId}`);
  console.log(`Success Rate: ${profile.successfulRequests / (profile.successfulRequests + profile.failedRequests)}`);
  console.log(`Avg Events/Block: ${profile.averageEventsPerBlock}`);
  console.log(`Max Range: ${profile.maxSuccessfulRange}`);
  console.log(`Error Patterns: ${profile.errorPatterns.length}`);
});
```

## Migration Guide

### From Existing Checkpoint

1. **Enable range optimization**:
```typescript
const config = {
  ...existingConfig,
  rangeOptimization: true
};
```

2. **Optional: Customize settings**:
```typescript
const config = {
  ...existingConfig,
  rangeOptimization: true,
  rangeOptimizationConfig: {
    safetyFactor: 0.8,
    maxRange: 15000
  }
};
```

3. **Monitor performance**:
```typescript
// Check network health periodically
setInterval(() => {
  const health = container.getNetworkHealth();
  if (health.healthStatus === 'unhealthy') {
    logger.warn('Network health degraded', health);
  }
}, 60000);
```

### Backward Compatibility

The optimizer maintains full backward compatibility:
- **Disabled by default**: Won't affect existing deployments
- **Fallback mode**: Reverts to original logic if optimizer fails
- **Graceful degradation**: Continues working even with corrupted profiles

## Troubleshooting

### Common Issues

1. **Profile corruption**:
   - Delete `.checkpoint-profiles.json`
   - Restart with fresh profiles

2. **Excessive backoff**:
   - Check RPC provider limits
   - Reduce `maxRange` in config
   - Increase `safetyFactor`

3. **Slow convergence**:
   - Increase `exponentialGrowthFactor`
   - Check network connectivity
   - Verify provider reliability

### Debug Commands

```typescript
// Reset network state
optimizer.resetNetwork('ethereum');

// Disable for testing
adapter.setEnabled(false);

// Check configuration
console.log(optimizer.getConfig());

// View error patterns
const profile = optimizer.getProfile('ethereum');
console.log(profile.errorPatterns);
```

## Contributing

To contribute to the Range Optimizer:

1. **Run tests**: `npm test src/range-optimizer`
2. **Check coverage**: `npm run test:coverage`
3. **Add new provider patterns**: Update error recognition in `range-optimizer.ts`
4. **Improve algorithms**: Enhance binary search or predictive calculation logic

## License

This code is part of the Checkpoint project and follows the same license terms.

## Support

For issues related to the Range Optimizer:
1. Check the [troubleshooting guide](#troubleshooting)
2. Review network health status
3. Enable debug logging
4. Open an issue with optimizer logs and network profiles