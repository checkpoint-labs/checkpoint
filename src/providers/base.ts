import type { Logger } from '../utils/logger';
import type Checkpoint from '../checkpoint';
import type { AsyncMySqlPool } from '../mysql';
import type { CheckpointConfig, CheckpointWriters } from '../types';

type Instance = {
  writer: CheckpointWriters;
  config: CheckpointConfig;
  setLastIndexedBlock(blockNum: number);
  insertCheckpoints(checkpoints: { blockNumber: number; contractAddress: string }[]);
  getWriterParams(): {
    instance: Checkpoint;
    mysql: AsyncMySqlPool;
  };
};

export class BaseProvider {
  protected readonly instance: Instance;
  protected readonly log: Logger;

  constructor({ instance, log }: { instance: Instance; log: Logger }) {
    this.instance = instance;
    this.log = log;
  }

  processBlock(blockNum: number) {
    throw new Error(`processBlock method was not defined when fetching block ${blockNum}`);
  }
}
