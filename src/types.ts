import { LogLevel } from './utils/logger';

export interface CheckpointOptions {
  // Set the log output levels for checkpoint. Defaults to Error.
  // Note, this does not affect the log outputs in writers.
  logLevel?: LogLevel;
  // optionally format logs to pretty output.
  // will require installing pino-pretty. Not recommended for production.
  prettifyLogs?: boolean;
  // Optional database connection screen. For now only accepts mysql database
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
  deploy_fn: string;
  events: ContractEventConfig[];
}

// Configuration used to initialize Checkpoint
export interface CheckpointConfig {
  network: SupportedNetworkName | string;
  sources: ContractSourceConfig[];
}

export type SupportedNetworkName = 'mainnet-alpha' | 'goerli-alpha';
