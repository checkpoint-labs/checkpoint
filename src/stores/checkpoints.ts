import * as crypto from 'crypto';
import { Knex } from 'knex';
import { Logger } from '../utils/logger';
import { chunk } from '../utils/helpers';
import { TemplateSource } from '../types';

const Table = {
  Blocks: '_blocks',
  Checkpoints: '_checkpoints',
  Metadata: '_metadatas', // using plural names to conform with standards entities,
  TemplateSources: '_template_sources'
};

const Fields = {
  Blocks: {
    Number: 'block_number',
    Hash: 'hash'
  },
  Checkpoints: {
    Id: 'id',
    BlockNumber: 'block_number',
    ContractAddress: 'contract_address'
  },
  Metadata: {
    Id: 'id',
    Value: 'value'
  },
  TemplateSources: {
    Id: 'id',
    ContractAddress: 'contract_address',
    StartBlock: 'start_block',
    Template: 'template'
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
  ConfigChecksum = 'config_checksum',
  SchemaVersion = 'schema_version'
}

export const INTERNAL_TABLES = Object.values(Table);

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

    const hasBlocksTable = await this.knex.schema.hasTable(Table.Blocks);
    const hasCheckpointsTable = await this.knex.schema.hasTable(Table.Checkpoints);
    const hasMetadataTable = await this.knex.schema.hasTable(Table.Metadata);
    const hasTemplateSourcesTable = await this.knex.schema.hasTable(Table.TemplateSources);

    let builder = this.knex.schema;

    if (!hasBlocksTable) {
      builder = builder.createTable(Table.Blocks, t => {
        t.bigint(Fields.Blocks.Number).primary();
        t.string(Fields.Blocks.Hash).notNullable().unique();
      });
    }

    if (!hasCheckpointsTable) {
      builder = builder.createTable(Table.Checkpoints, t => {
        t.string(Fields.Checkpoints.Id, CheckpointIdSize).primary();
        t.bigint(Fields.Checkpoints.BlockNumber).notNullable().index();
        t.string(Fields.Checkpoints.ContractAddress, 66).notNullable().index();
      });
    }

    if (!hasMetadataTable) {
      builder = builder.createTable(Table.Metadata, t => {
        t.string(Fields.Metadata.Id, 20).primary();
        t.string(Fields.Metadata.Value, 128).notNullable();
      });
    }

    if (!hasTemplateSourcesTable) {
      builder = builder.createTable(Table.TemplateSources, t => {
        t.increments(Fields.TemplateSources.Id);
        t.string(Fields.TemplateSources.ContractAddress, 66);
        t.bigint(Fields.TemplateSources.StartBlock).notNullable();
        t.string(Fields.TemplateSources.Template, 128).notNullable();
      });
    }

    await builder;

    this.log.debug('checkpoints tables created');

    return { builder };
  }

  /**
   * Recreates core database tables.
   *
   * Calling it will cause all checkpoints to be deleted and will force
   * syncing to start from start.
   *
   */
  public async resetStore(): Promise<void> {
    this.log.debug('truncating checkpoints tables');

    const hasBlocksTable = await this.knex.schema.hasTable(Table.Blocks);
    const hasCheckpointsTable = await this.knex.schema.hasTable(Table.Checkpoints);
    const hasMetadataTable = await this.knex.schema.hasTable(Table.Metadata);
    const hasTemplateSourcesTable = await this.knex.schema.hasTable(Table.TemplateSources);

    if (hasBlocksTable) {
      await this.knex.schema.dropTable(Table.Blocks);
    }

    if (hasCheckpointsTable) {
      await this.knex.schema.dropTable(Table.Checkpoints);
    }

    if (hasMetadataTable) {
      await this.knex.schema.dropTable(Table.Metadata);
    }

    if (hasTemplateSourcesTable) {
      await this.knex.schema.dropTable(Table.TemplateSources);
    }

    this.log.debug('checkpoints tables dropped');

    await this.createStore();
  }

  public async removeBlocks(): Promise<void> {
    return this.knex(Table.Blocks).del();
  }

  public async getBlockHash(blockNumber: number): Promise<string | null> {
    const blocks = await this.knex
      .select(Fields.Blocks.Hash)
      .from(Table.Blocks)
      .where(Fields.Blocks.Number, blockNumber)
      .limit(1);

    if (blocks.length == 0) {
      return null;
    }

    return blocks[0][Fields.Blocks.Hash];
  }

  public async setBlockHash(blockNumber: number, hash: string): Promise<void> {
    await this.knex.table(Table.Blocks).insert({
      [Fields.Blocks.Number]: blockNumber,
      [Fields.Blocks.Hash]: hash
    });
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
    const insert = async (items: CheckpointRecord[]) => {
      try {
        if (items.length === 0) {
          return;
        }

        await this.knex
          .table(Table.Checkpoints)
          .insert(
            items.map(checkpoint => {
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
      } catch (err: any) {
        if (['ER_LOCK_DEADLOCK', '40P01'].includes(err.code)) {
          this.log.debug('deadlock detected, retrying...');
          return this.insertCheckpoints(items);
        }

        throw err;
      }
    };

    await Promise.all(chunk(checkpoints, 1000).map(chunk => insert(chunk)));
  }

  public async removeFutureData(blockNumber: number): Promise<void> {
    return this.knex.transaction(async trx => {
      await trx
        .table(Table.Metadata)
        .insert({
          [Fields.Metadata.Id]: MetadataId.LastIndexedBlock,
          [Fields.Metadata.Value]: blockNumber
        })
        .onConflict(Fields.Metadata.Id)
        .merge();

      await trx
        .table(Table.Checkpoints)
        .where(Fields.Checkpoints.BlockNumber, '>', blockNumber)
        .del();

      await trx.table(Table.Blocks).where(Fields.Blocks.Number, '>', blockNumber).del();
    });
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
      .distinct(Fields.Checkpoints.BlockNumber)
      .from(Table.Checkpoints)
      .where(Fields.Checkpoints.BlockNumber, '>=', block)
      .whereIn(Fields.Checkpoints.ContractAddress, contracts)
      .orderBy(Fields.Checkpoints.BlockNumber, 'asc')
      .limit(limit);

    this.log.debug({ result, block, contracts }, 'next checkpoint blocks');

    return result.map(value => Number(value[Fields.Checkpoints.BlockNumber]));
  }

  public async insertTemplateSource(
    contractAddress: string,
    startBlock: number,
    template: string
  ): Promise<void> {
    return this.knex.table(Table.TemplateSources).insert({
      [Fields.TemplateSources.ContractAddress]: contractAddress,
      [Fields.TemplateSources.StartBlock]: startBlock,
      [Fields.TemplateSources.Template]: template
    });
  }

  public async getTemplateSources(): Promise<TemplateSource[]> {
    const data = await this.knex
      .select(
        Fields.TemplateSources.ContractAddress,
        Fields.TemplateSources.StartBlock,
        Fields.TemplateSources.Template
      )
      .from(Table.TemplateSources);

    return data.map(row => ({
      contractAddress: row[Fields.TemplateSources.ContractAddress],
      startBlock: row[Fields.TemplateSources.StartBlock],
      template: row[Fields.TemplateSources.Template]
    }));
  }
}
