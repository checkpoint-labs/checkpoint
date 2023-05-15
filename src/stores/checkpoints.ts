import * as crypto from 'crypto';
import { Knex } from 'knex';
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
  LastIndexedBlock = 'last_indexed_block',
  NetworkIdentifier = 'network_identifier',
  StartBlock = 'start_block',
  ConfigChecksum = 'config_checksum'
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
 * It interacts with an underlying database.
 */
export class CheckpointsStore {
  private readonly log: Logger;

  constructor(private readonly knex: Knex, log: Logger) {
    this.log = log.child({ component: 'checkpoints_store' });
  }

  /**
   * Creates the core database tables to make Checkpoint run effectively.
   *
   * This only creates the tables if they don't exist.
   */
  public async createStore(): Promise<{ builder: Knex.SchemaBuilder }> {
    this.log.debug('creating checkpoints tables...');

    const hasCheckpointsTable = await this.knex.schema.hasTable(Table.Checkpoints);
    const hasMetadataTable = await this.knex.schema.hasTable(Table.Metadata);

    let builder = this.knex.schema;

    if (!hasCheckpointsTable) {
      builder = builder.createTable(Table.Checkpoints, t => {
        t.string(Fields.Checkpoints.Id, CheckpointIdSize).primary();
        t.bigint(Fields.Checkpoints.BlockNumber).notNullable();
        t.string(Fields.Checkpoints.ContractAddress, 66).notNullable();
      });
    }

    if (!hasMetadataTable) {
      builder = builder.dropTableIfExists(Table.Metadata).createTable(Table.Metadata, t => {
        t.string(Fields.Metadata.Id, 20).primary();
        t.string(Fields.Metadata.Value, 128).notNullable();
      });
    }

    await builder;

    this.log.debug('checkpoints tables created');

    return { builder };
  }

  /**
   * Truncates core database tables.
   *
   * Calling it will cause all checkpoints to be deleted and will force
   * syncing to start from start.
   *
   */
  public async resetStore(): Promise<void> {
    this.log.debug('truncating checkpoints tables');

    const hasCheckpointsTable = await this.knex.schema.hasTable(Table.Checkpoints);
    const hasMetadataTable = await this.knex.schema.hasTable(Table.Metadata);

    if (hasCheckpointsTable) {
      await this.knex(Table.Checkpoints).truncate();
    }

    if (hasMetadataTable) {
      await this.knex(Table.Metadata).truncate();
    }

    this.log.debug('checkpoints tables truncated');
  }

  public async getMetadata(id: string): Promise<string | null> {
    const value = await this.knex
      .select(Fields.Metadata.Value)
      .from(Table.Metadata)
      .where(Fields.Metadata.Id, id)
      .limit(1);

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
    await this.knex
      .table(Table.Metadata)
      .insert({
        [Fields.Metadata.Id]: id,
        [Fields.Metadata.Value]: value
      })
      .onConflict(Fields.Metadata.Id)
      .merge();
  }

  public async insertCheckpoints(checkpoints: CheckpointRecord[]): Promise<void> {
    if (checkpoints.length === 0) {
      return;
    }

    await this.knex
      .table(Table.Checkpoints)
      .insert(
        checkpoints.map(checkpoint => {
          const id = getCheckpointId(checkpoint.contractAddress, checkpoint.blockNumber);

          return {
            [Fields.Checkpoints.Id]: id,
            [Fields.Checkpoints.BlockNumber]: checkpoint.blockNumber,
            [Fields.Checkpoints.ContractAddress]: checkpoint.contractAddress
          };
        })
      )
      .onConflict(Fields.Checkpoints.Id)
      .ignore();
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
    const result = await this.knex
      .select(Fields.Checkpoints.BlockNumber)
      .from(Table.Checkpoints)
      .where(Fields.Checkpoints.BlockNumber, '>=', block)
      .whereIn(Fields.Checkpoints.ContractAddress, contracts)
      .orderBy(Fields.Checkpoints.BlockNumber, 'asc')
      .limit(limit);

    this.log.debug({ result, block, contracts }, 'next checkpoint blocks');

    return result.map(value => Number(value[Fields.Checkpoints.BlockNumber]));
  }
}
