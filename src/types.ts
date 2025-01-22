import { z } from 'zod';
import { LogLevel } from './utils/logger';
import {
  contractSourceConfigSchema,
  contractTemplateSchema,
  checkpointConfigSchema,
  overridesConfigSchema
} from './schemas';
import { Instance } from './providers';

export type TemplateSource = {
  contractAddress: string;
  startBlock: number;
  template: string;
};

export interface CheckpointOptions {
  // Setting to true will trigger reset of database on config changes.
  resetOnConfigChange?: boolean;
  // Set the log output levels for checkpoint. Defaults to Error.
  // Note, this does not affect the log outputs in writers.
  logLevel?: LogLevel;
  // optionally format logs to pretty output.
  // Not recommended for production.
  prettifyLogs?: boolean;
  // Optional database connection string. For now only accepts PostgreSQL and MySQL/MariaDB
  // connection string. If no provided will default to looking up a value in
  // the DATABASE_URL environment.
  dbConnection?: string;
  overridesConfig?: OverridesConfig;
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
