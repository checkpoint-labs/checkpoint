# Range Optimizer Integration Guide

This guide explains how to integrate the Range Optimizer into your existing Checkpoint project.

## Quick Start

### 1. Enable Range Optimization

```typescript
// In your Checkpoint configuration
const config = {
  // ... your existing config
  rangeOptimization: true // Enable the optimizer
};

const checkpoint = new Checkpoint(config);
```

### 2. Optional: Custom Configuration

```typescript
const config = {
  // ... your existing config
  rangeOptimization: true,
  rangeOptimizationConfig: {
    safetyFactor: 0.8,        // Use 80% of estimated provider limit
    maxRange: 15000,          // Maximum block range
    initialRange: 2000,       // Starting range
    profilePersistenceEnabled: true // Save profiles between restarts
  }
};
```

## Integration Points

### 1. Container Class Integration

The Range Optimizer integrates with Checkpoint's `Container` class at these points:

#### A. Preload Range Calculation

**Before (Original)**:
```typescript
// src/container.ts (line 208)
const endBlock = Math.min(currentBlock + this.preloadStep, this.preloadEndBlock);
```

**After (Optimized)**:
```typescript
const endBlock = await this.calculateEndBlock(currentBlock);

private async calculateEndBlock(currentBlock: number): Promise<number> {
  if (this.rangeAdapter && this.rangeOptimizerEnabled) {
    const optimalRange = await this.rangeAdapter.getOptimalPreloadRange(
      currentBlock,
      this.preloadEndBlock,
      0 // estimated events
    );
    return Math.min(currentBlock + optimalRange, this.preloadEndBlock);
  } else {
    return Math.min(currentBlock + this.preloadStep, this.preloadEndBlock);
  }
}
```

#### B. Result Processing

**Before (Original)**:
```typescript
// src/container.ts (line 222-224)
const increase = checkpoints.length > BLOCK_PRELOAD_TARGET ? -BLOCK_PRELOAD_STEP : +BLOCK_PRELOAD_STEP;
this.preloadStep = Math.max(BLOCK_RELOAD_MIN_RANGE, this.preloadStep + increase);
```

**After (Optimized)**:
```typescript
// Record the result for learning
if (this.rangeAdapter) {
  this.rangeAdapter.processPreloadResult(
    currentBlock,
    endBlock,
    true, // success
    checkpoints.length,
    undefined,
    responseTime
  );
}
```

### 2. Provider Integration

#### A. EVM Provider Enhancement

**Before (Original)**:
```typescript
// src/providers/evm/provider.ts
async getLogs(fromBlock: number, toBlock: number, addresses: string[], topics: string[][]) {
  // Fixed range logic
  const logs = await this._getLogs(fromBlock, toBlock, addresses, topics);
  return logs;
}
```

**After (Optimized)**:
```typescript
async getLogs(fromBlock: number, toBlock: number, addresses: string[], topics: string[][]) {
  let currentBlock = fromBlock;
  const allLogs: any[] = [];
  
  while (currentBlock <= toBlock) {
    const optimalRange = await this.getOptimalRange(currentBlock, toBlock);
    const endBlock = Math.min(currentBlock + optimalRange, toBlock);
    
    try {
      const logs = await this._getLogs(currentBlock, endBlock, addresses, topics);
      this.processRangeResult(currentBlock, endBlock, true, logs.length);
      allLogs.push(...logs);
      currentBlock = endBlock + 1;
    } catch (error) {
      this.processRangeResult(currentBlock, endBlock, false, 0, error);
      await this.handleRangeError(error, consecutiveFailures);
    }
  }
  
  return allLogs;
}
```

#### B. StarkNet Provider Enhancement

Similar pattern for StarkNet providers with `getEvents` method.

### 3. Error Handling Integration

The optimizer enhances error handling with provider-specific recognition:

```typescript
// Recognizes provider-specific errors
if (error.message.includes('infura') && error.message.includes('response size')) {
  // Handle Infura response size limit
  return this.handleEventLimitError(error, currentRange);
}

if (error.message.includes('alchemy') && error.message.includes('compute units')) {
  // Handle Alchemy compute unit limit
  return this.handleEventLimitError(error, currentRange);
}
```

## Configuration Options

### Network-Specific Settings

```typescript
// Ethereum mainnet - high throughput, generous limits
const ethereumConfig = {
  initialRange: 2000,
  maxRange: 10000,
  safetyFactor: 0.8,
  exponentialGrowthFactor: 2.0
};

// Polygon - moderate limits, faster blocks
const polygonConfig = {
  initialRange: 1000,
  maxRange: 3000,
  safetyFactor: 0.7,
  exponentialGrowthFactor: 1.8
};

// Avalanche - conservative limits
const avalancheConfig = {
  initialRange: 500,
  maxRange: 2000,
  safetyFactor: 0.6,
  exponentialGrowthFactor: 1.5
};
```

### Environment-Specific Settings

```typescript
// Development - conservative for testing
const devConfig = {
  initialRange: 500,
  maxRange: 2000,
  safetyFactor: 0.5,
  profilePersistenceEnabled: false
};

// Production - optimized for performance
const prodConfig = {
  initialRange: 1000,
  maxRange: 10000,
  safetyFactor: 0.8,
  profilePersistenceEnabled: true,
  profileStoragePath: '/data/checkpoint-profiles.json'
};
```

## Migration Steps

### Step 1: Update Dependencies

```bash
# Install any new dependencies if needed
npm install
```

### Step 2: Update Configuration

```typescript
// Update your existing config
const config = {
  // ... existing configuration
  rangeOptimization: true, // Add this line
  
  // Optional: Add custom config
  rangeOptimizationConfig: {
    safetyFactor: 0.8,
    maxRange: 10000
  }
};
```

### Step 3: Test Integration

```typescript
// Add monitoring to your application
const checkpoint = new Checkpoint(config);

// Monitor network health
setInterval(() => {
  const health = checkpoint.getNetworkHealth();
  if (health) {
    console.log(`Network Health: ${health.healthStatus}`);
    console.log(`Success Rate: ${health.successRate}`);
    console.log(`Optimal Range: ${health.optimalRange}`);
  }
}, 60000);
```

### Step 4: Gradual Rollout

```typescript
// Start with a conservative configuration
const config = {
  rangeOptimization: true,
  rangeOptimizationConfig: {
    safetyFactor: 0.6,      // Conservative
    maxRange: 5000,         // Lower limit
    initialRange: 500       // Start small
  }
};

// Monitor for a few hours, then increase limits
setTimeout(() => {
  checkpoint.updateRangeConfig({
    safetyFactor: 0.8,
    maxRange: 10000,
    initialRange: 1000
  });
}, 3600000); // After 1 hour
```

## Monitoring and Alerting

### Health Monitoring

```typescript
function checkNetworkHealth() {
  const health = checkpoint.getNetworkHealth();
  
  if (health.healthStatus === 'unhealthy') {
    // Alert: Network is unhealthy
    console.error('Network unhealthy:', {
      circuitBreakerOpen: health.circuitBreakerOpen,
      successRate: health.successRate,
      backoffTime: health.backoffTimeRemaining
    });
  }
  
  if (health.successRate < 0.8) {
    // Warning: Low success rate
    console.warn('Low success rate:', health.successRate);
  }
}
```

### Performance Metrics

```typescript
function logPerformanceMetrics() {
  const profiles = checkpoint.getAllNetworkProfiles();
  
  profiles.forEach(profile => {
    const totalRequests = profile.successfulRequests + profile.failedRequests;
    const successRate = totalRequests > 0 ? profile.successfulRequests / totalRequests : 0;
    
    console.log(`Network: ${profile.networkId}`);
    console.log(`  Success Rate: ${successRate.toFixed(2)}`);
    console.log(`  Avg Events/Block: ${profile.averageEventsPerBlock.toFixed(2)}`);
    console.log(`  Optimal Range: ${profile.lastOptimalRange}`);
    console.log(`  Error Patterns: ${profile.errorPatterns.length}`);
  });
}
```

## Troubleshooting

### Common Issues

1. **Optimizer Not Starting**
   ```typescript
   // Check if initialization completed
   if (!checkpoint.isRangeOptimizerEnabled()) {
     console.log('Range optimizer not enabled');
   }
   ```

2. **Profile Corruption**
   ```bash
   # Remove corrupted profile file
   rm .checkpoint-profiles.json
   
   # Restart with fresh profiles
   ```

3. **Excessive Backoff**
   ```typescript
   // Check backoff status
   const health = checkpoint.getNetworkHealth();
   if (health.inBackoff) {
     console.log(`Backoff time remaining: ${health.backoffTimeRemaining}ms`);
   }
   ```

### Debug Configuration

```typescript
const debugConfig = {
  rangeOptimization: true,
  rangeOptimizationConfig: {
    safetyFactor: 0.9,      // Very conservative
    maxRange: 1000,         // Low limit for debugging
    initialRange: 100,      // Start very small
    baseBackoffDuration: 5000, // Longer backoff for debugging
    profilePersistenceEnabled: false // Don't save corrupted profiles
  }
};
```

## Performance Tuning

### Aggressive Configuration (High-Performance Networks)

```typescript
const aggressiveConfig = {
  rangeOptimization: true,
  rangeOptimizationConfig: {
    safetyFactor: 0.9,
    maxRange: 20000,
    initialRange: 5000,
    exponentialGrowthFactor: 3.0,
    binarySearchThreshold: 0.9
  }
};
```

### Conservative Configuration (Unreliable Networks)

```typescript
const conservativeConfig = {
  rangeOptimization: true,
  rangeOptimizationConfig: {
    safetyFactor: 0.5,
    maxRange: 1000,
    initialRange: 100,
    exponentialGrowthFactor: 1.3,
    maxBackoffDuration: 300000
  }
};
```

## Testing

### Unit Tests

```bash
# Run optimizer tests
npm test src/range-optimizer

# Run with coverage
npm run test:coverage src/range-optimizer
```

### Integration Tests

```typescript
// Test with your specific provider
describe('Range Optimizer Integration', () => {
  it('should optimize ranges for my provider', async () => {
    const checkpoint = new Checkpoint({
      rangeOptimization: true,
      // ... your config
    });
    
    await checkpoint.start();
    
    // Your integration tests here
  });
});
```

### Load Testing

```typescript
// Simulate high load
async function loadTest() {
  const checkpoint = new Checkpoint(config);
  
  // Run multiple concurrent indexers
  const promises = [];
  for (let i = 0; i < 10; i++) {
    promises.push(checkpoint.processBlocks(i * 1000, (i + 1) * 1000));
  }
  
  await Promise.all(promises);
  
  // Check health after load
  const health = checkpoint.getNetworkHealth();
  console.log('Health after load test:', health);
}
```

## Best Practices

1. **Start Conservative**: Begin with low ranges and safety factors
2. **Monitor Health**: Check network health regularly
3. **Gradual Rollout**: Increase limits gradually after monitoring
4. **Profile Backup**: Backup `.checkpoint-profiles.json` regularly
5. **Provider Testing**: Test with your specific RPC provider
6. **Error Monitoring**: Set up alerts for network health degradation

## Support

For integration support:
1. Check the [troubleshooting section](#troubleshooting)
2. Review network health status
3. Enable debug logging
4. Share network profiles and error patterns when reporting issues