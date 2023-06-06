import { z } from 'zod';
import { Pool as PgPool } from 'pg';
import { RPC } from 'starknet';
import Checkpoint from './checkpoint';
import { AsyncMySqlPool } from './mysql';
import { LogLevel } from './utils/logger';
import { BaseProvider } from './providers';
import {
  contractSourceConfigSchema,
  contractTemplateSchema,
  checkpointConfigSchema
} from './schemas';

// Shortcuts to starknet types.
export type Block = RPC.GetBlockWithTxs;
export type Transaction = RPC.Transaction;
export type PendingTransaction = RPC.PendingTransactions[number];
export type Event = RPC.GetEventsResponse['events'][number];

// (Partially) narrowed types as real types are not exported from `starknet`.
export type FullBlock = Block & { block_number: number };
export type DeployTransaction = Transaction & { contract_address: string };

export type EventsMap = { [key: string]: Event[] };
export type ParsedEvent = Record<string, any>;

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
  // BaseProvider based class that defines how blocks are fetched and processed.
  NetworkProvider?: typeof BaseProvider;
}

export type ContractSourceConfig = z.infer<typeof contractSourceConfigSchema>;
export type ContractTemplate = z.infer<typeof contractTemplateSchema>;
export type CheckpointConfig = z.infer<typeof checkpointConfigSchema>;

/**
 * Callback function invoked by checkpoint when a contract event
 * is encountered. A writer function should use the `mysql`
 * object to write to the database entities based on the require logic.
 *
 * For example, if a graphql Entity is defined in the schema:
 *
 * ```graphql
 * type Vote {
 *  id: ID!
 *  voter: String!
 * }
 * ```
 *
 * Then you can insert into the entity into the database like:
 * ```typescript
 * await args.mysql.queryAsync('INSERT INTO votes VALUES(?, ?);', ['voteId', 'voters-address']);
 *
 * // or using pg
 * await args.pg.query('INSERT INTO votes VALUES($1, $2);', ['voteId', 'voters-address']);
 * ```
 *
 * Note, Graphql Entity names are lowercased with an 's' suffix when
 * interacting with them in the databas.
 *e
 */
export type CheckpointWriter = (args: {
  tx: Transaction;
  block: FullBlock | null;
  blockNumber: number;
  event?: ParsedEvent;
  rawEvent?: Event;
  eventIndex?: number;
  source?: ContractSourceConfig;
  mysql: AsyncMySqlPool;
  pg: PgPool;
  instance: Checkpoint;
}) => Promise<void>;

/**
 * Object map of events to CheckpointWriters.
 *
 * The CheckpointWriter function will be invoked when an
 * event matching a key is found.
 *
 */
export interface CheckpointWriters {
  [event: string]: CheckpointWriter;
}

export function isFullBlock(block: Block): block is FullBlock {
  return 'block_number' in block;
}

export function isDeployTransaction(tx: Transaction | PendingTransaction): tx is DeployTransaction {
  return tx.type === 'DEPLOY';
}
