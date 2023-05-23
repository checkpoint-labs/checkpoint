import { Pool as PgPool } from 'pg';
import type { Logger } from '../utils/logger';
import type Checkpoint from '../checkpoint';
import type { AsyncMySqlPool } from '../mysql';
import type { CheckpointConfig, CheckpointWriters } from '../types';

type Instance = {
  writer: CheckpointWriters;
  config: CheckpointConfig;
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

  getNetworkIdentifier(): Promise<string> {
    throw new Error('getNetworkIdentifier method was not defined');
  }

  processBlock(blockNum: number): Promise<number> {
    throw new Error(`processBlock method was not defined when fetching block ${blockNum}`);
  }

  processPool(blockNumber: number) {
    throw new Error(
      `processPool method was not defined when fetching pool for block ${blockNumber}`
    );
  }
}
