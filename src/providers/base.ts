import { Pool as PgPool } from 'pg';
import Checkpoint from '../checkpoint';
import { CheckpointRecord } from '../stores/checkpoints';
import { Logger } from '../utils/logger';
import { AsyncMySqlPool } from '../mysql';
import { CheckpointConfig, CheckpointWriters, ContractSourceConfig } from '../types';

type Instance = {
  writer: CheckpointWriters;
  config: CheckpointConfig;
  getCurrentSources(blockNumber: number): ContractSourceConfig[];
  setLastIndexedBlock(blockNum: number);
  insertCheckpoints(checkpoints: { blockNumber: number; contractAddress: string }[]);
  getWriterParams(): Promise<{
    instance: Checkpoint;
    mysql: AsyncMySqlPool;
    pg: PgPool;
  }>;
};

export class BlockNotFoundError extends Error {
  constructor() {
    super('Block not found');
    this.name = 'BlockNotFoundError';
  }
}

export class BaseProvider {
  protected readonly instance: Instance;
  protected readonly log: Logger;
  protected readonly abis: Record<string, any> = {};

  constructor({
    instance,
    log,
    abis
  }: {
    instance: Instance;
    log: Logger;
    abis?: Record<string, any>;
  }) {
    this.instance = instance;
    this.log = log;
    if (abis) {
      this.abis = abis;
    }
  }

  init(): Promise<void> {
    throw new Error('init method was not defined');
  }

  formatAddresses(addresses: string[]): string[] {
    throw new Error(
      `formatAddresses method was not defined when formatting ${addresses.length} addresses`
    );
  }

  getNetworkIdentifier(): Promise<string> {
    throw new Error('getNetworkIdentifier method was not defined');
  }

  getLatestBlockNumber(): Promise<number> {
    throw new Error('getLatestBlockNumber method was not defined');
  }

  processBlock(blockNum: number): Promise<number> {
    throw new Error(`processBlock method was not defined when fetching block ${blockNum}`);
  }

  processPool(blockNumber: number) {
    throw new Error(
      `processPool method was not defined when fetching pool for block ${blockNumber}`
    );
  }

  async getCheckpointsRange(fromBlock: number, toBlock: number): Promise<CheckpointRecord[]> {
    throw new Error(
      `getEventsRange method was not defined when fetching events from ${fromBlock} to ${toBlock}`
    );
  }
}
