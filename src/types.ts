import { AsyncMySqlPool } from './mysql';
import { LogLevel } from './utils/logger';
import type { api } from 'starknet';

// Shortcuts to starknet types.
export type Block = api.RPC.GetBlockWithTxs;
export type Transaction = api.RPC.Transaction;
export type Event = api.RPC.GetEventsResponse['events'][number];

// (Partially) narrowed types as real types are not exported from `starknet`.
export type FullBlock = Block & { block_number: number };
export type DeployTransaction = Transaction & { contract_address: string };

export type EventsMap = { [key: string]: Event[] };

export interface CheckpointOptions {
  // Set the log output levels for checkpoint. Defaults to Error.
  // Note, this does not affect the log outputs in writers.
  logLevel?: LogLevel;
  // optionally format logs to pretty output.
  // Not recommended for production.
  prettifyLogs?: boolean;
  // Optional database connection string. For now only accepts mysql database
  // connection string. If no provided will default to looking up a value in
  // the DATABASE_URL environment.
  dbConnection?: string;
  // Configuration for decimal types
  // defaults to Decimal(10, 2), BigDecimal(20, 8)
  decimalTypes?: { [key: string]: { p: number; d: number } };
}

export interface ContractEventConfig {
  // name of event in the contract
  name: string;
  // callback function in writer
  fn: string;
}

export interface ContractSourceConfig {
  // contract address
  contract: string;
  // start block number
  start: number;
  // callback function in writer to handle deployment
  deploy_fn?: string;
  events: ContractEventConfig[];
}

// Configuration used to initialize Checkpoint
export interface CheckpointConfig {
  network_node_url: string;
  start?: number;
  tx_fn?: string;
  sources?: ContractSourceConfig[];
}

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
 * ```
 *
 * Note, Graphql Entity names are lowercased with an 's' suffix when
 * interacting with them in the databas.
 *e
 */
export type CheckpointWriter = (args: {
  tx: Transaction;
  block: Block;
  event?: Event;
  source?: ContractSourceConfig;
  mysql: AsyncMySqlPool;
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

export function isDeployTransaction(tx: Transaction): tx is DeployTransaction {
  return tx.type === 'DEPLOY';
}
