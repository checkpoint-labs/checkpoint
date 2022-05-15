import * as crypto from 'crypto';
import { AsyncMySqlPool } from '../mysql';
import { Logger } from '../utils/logger';

const Table = {
  Checkpoints: '_checkpoints',
  Metadata: '_metadatas' // using plural names to confirm with standards entities
};

const Fields = {
  Checkpoints: {
    Id: 'id',
    BlockNumber: 'block_number',
    ContractAddress: 'contract_address'
  },
  Metadata: {
    Id: 'id',
    Value: 'value'
  }
};

type ToString = {
  toString: () => string;
};

export interface CheckpointRecord {
  blockNumber: number;
  contractAddress: string;
}

/**
 * Metadata Ids stored in the CheckpointStore.
 *
 */
export enum MetadataId {
  LastIndexedBlock = 'last_indexed_block'
}

const CheckpointIdSize = 10;

/**
 * Generates a unique hex based on the contract address and block number.
 * Used when as id for storing checkpoints records.
 *
 */
export const getCheckpointId = (contract: string, block: number): string => {
  const data = `${contract}${block}`;
  return crypto.createHash('sha256').update(data).digest('hex').slice(-CheckpointIdSize);
};

/**
 * Checkpoints store is a data store class for managing
 * checkpoints data schema and records.
 *
 * It interacts with an underlying mysql database.
 */
export class CheckpointsStore {
  private readonly log: Logger;

  constructor(private readonly mysql: AsyncMySqlPool, log: Logger) {
    this.log = log.child({ component: 'checkpoints_store' });
  }

  /**
   * Creates the core database tables to make Checkpoint run effectively.
   *
   * This only creates the tables if they don't exist.
   */
  public async createStore(): Promise<void> {
    this.log.debug('creating checkpoints tables...');

    let sql = `CREATE TABLE IF NOT EXISTS ${Table.Checkpoints} (
      ${Fields.Checkpoints.Id} VARCHAR(${CheckpointIdSize}) NOT NULL,
      ${Fields.Checkpoints.BlockNumber} BIGINT NOT NULL,
      ${Fields.Checkpoints.ContractAddress} VARCHAR(66) NOT NULL,
      PRIMARY KEY (${Fields.Checkpoints.Id})
    );`;

    sql += `\nCREATE TABLE IF NOT EXISTS ${Table.Metadata} (
      ${Fields.Metadata.Id} VARCHAR(20) NOT NULL,
      ${Fields.Metadata.Value} VARCHAR(128) NOT NULL,
      PRIMARY KEY (${Fields.Metadata.Id})
    );`;

    await this.mysql.queryAsync(sql);
    this.log.debug('checkpoints tables created');
  }

  public async getMetadata(id: string): Promise<string | null> {
    const value = await this.mysql.queryAsync(
      `SELECT ${Fields.Metadata.Value} FROM ${Table.Metadata} WHERE ${Fields.Metadata.Id} = ? LIMIT 1`,
      [id]
    );

    if (value.length == 0) {
      return null;
    }

    return value[0][Fields.Metadata.Value];
  }

  public async getMetadataNumber(id: string, base = 10): Promise<number | undefined> {
    const strValue = await this.getMetadata(id);
    if (!strValue) {
      return undefined;
    }

    return parseInt(strValue, base);
  }

  public async setMetadata(id: string, value: ToString): Promise<void> {
    await this.mysql.queryAsync(`REPLACE INTO ${Table.Metadata} VALUES (?,?)`, [
      id,
      value.toString()
    ]);
  }

  public async insertCheckpoints(checkpoints: CheckpointRecord[]): Promise<void> {
    if (checkpoints.length === 0) {
      return;
    }
    await this.mysql.queryAsync(`INSERT IGNORE INTO ${Table.Checkpoints} VALUES ?`, [
      checkpoints.map(checkpoint => {
        const id = getCheckpointId(checkpoint.contractAddress, checkpoint.blockNumber);
        return [id, checkpoint.blockNumber, checkpoint.contractAddress];
      })
    ]);
  }

  /**
   * Fetch list of checkpoint blocks greater than or equal to the
   * block number arguments, that have some events related to the
   * contracts in the lists.
   *
   * By default this returns at most 15 next blocks. This return limit
   * can be modified by the limit command.
   */
  public async getNextCheckpointBlocks(
    block: number,
    contracts: string[],
    limit = 15
  ): Promise<number[]> {
    const result = await this.mysql.queryAsync(
      `SELECT ${Fields.Checkpoints.BlockNumber} FROM ${Table.Checkpoints} 
      WHERE ${Fields.Checkpoints.BlockNumber} >= ?
        AND ${Fields.Checkpoints.ContractAddress} IN (?)
      ORDER BY ${Fields.Checkpoints.BlockNumber} ASC
      LIMIT ?`,
      [block, contracts, limit]
    );

    this.log.debug({ result, block, contracts }, 'next checkpoint blocks');

    return result.map(value => value[Fields.Checkpoints.BlockNumber]);
  }
}
