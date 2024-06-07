import { z } from 'zod';
import { Pool as PgPool } from 'pg';
import Checkpoint from './checkpoint';
import { LogLevel } from './utils/logger';
import {
  contractSourceConfigSchema,
  contractTemplateSchema,
  checkpointConfigSchema
} from './schemas';

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
  // Optional interval in milliseconds to check for new blocks.
  fetchInterval?: number;
  // Optional database connection string. For now only accepts PostgreSQL and MySQL/MariaDB
  // connection string. If no provided will default to looking up a value in
  // the DATABASE_URL environment.
  dbConnection?: string;
  // Abis for contracts needed for automatic event parsing
  abis?: Record<string, any>;
}

export type ContractSourceConfig = z.infer<typeof contractSourceConfigSchema>;
export type ContractTemplate = z.infer<typeof contractTemplateSchema>;
export type CheckpointConfig = z.infer<typeof checkpointConfigSchema>;

export type BaseWriterParams = {
  blockNumber: number;
  eventIndex?: number;
  source?: ContractSourceConfig;
  pg: PgPool;
  instance: Checkpoint;
};
