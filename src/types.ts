import { Transaction, TransactionReceipt, GetBlockResponse } from 'starknet';
import { AsyncMySqlPool } from './mysql';
import { LogLevel } from './utils/logger';

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
  // mainnet-alpha or goerli-alpha network. If not interested
  // in using the default starknet provider urls, then
  // leave this undefined and use the network_base_url
  network?: SupportedNetworkName | string;
  network_base_url?: string;
  start?: number;
  tx_fn?: string;
  sources?: ContractSourceConfig[];
}

export type SupportedNetworkName = 'mainnet-alpha' | 'goerli-alpha';

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
  block: GetBlockResponse;
  receipt: TransactionReceipt;
  event?: Array<any>;
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
