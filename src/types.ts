import { z } from 'zod';
import { LogLevel } from './utils/logger';
import {
  contractSourceConfigSchema,
  contractTemplateSchema,
  checkpointConfigSchema,
  overridesConfigSchema
} from './schemas';
import { Instance } from './providers';
import { OptimizationConfig } from './range-optimizer/types';

export type TemplateSource = {
  contractAddress: string;
  startBlock: number;
  template: string;
};

export interface CheckpointOptions {
  /** Setting this to true will trigger reset of database on config changes. */
  resetOnConfigChange?: boolean;
  /**
   * Set the log output levels for checkpoint. Defaults to Error.
   * Note, this does not affect the log outputs in writers.
   */
  logLevel?: LogLevel;
  /** Format logs to pretty output. Not recommended for production. */
  prettifyLogs?: boolean;
  /**
   * Optional database connection string. Must be PostgreSQL connection string.
   * If not provided connection strinng will be read from DATABASE_URL environment variable.
   */
  dbConnection?: string;
  /** Overrides for database types. */
  overridesConfig?: OverridesConfig;
  /**
   * Skip fetching blocks from the network.
   * This can speed up indexing process if you don't need block data.
   */
  skipBlockFetching?: boolean;
  /** Enable/disable range optimization. Enabled by default. */
  rangeOptimization?: boolean;
  /** Range optimization configuration options. */
  rangeOptimizationConfig?: Partial<OptimizationConfig>;
}

export type ContractSourceConfig = z.infer<typeof contractSourceConfigSchema>;
export type ContractTemplate = z.infer<typeof contractTemplateSchema>;
export type CheckpointConfig = z.infer<typeof checkpointConfigSchema>;
export type OverridesConfig = z.infer<typeof overridesConfigSchema>;

export type BaseWriterParams = {
  blockNumber: number;
  eventIndex?: number;
  source?: ContractSourceConfig;
  helpers: ReturnType<Instance['getWriterHelpers']>;
};

// Re-export range optimizer types for convenience
export * from './range-optimizer/types';
