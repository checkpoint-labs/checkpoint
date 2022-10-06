import * as crypto from 'crypto';
import { Logger } from '../utils/logger';

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

  constructor(private readonly prisma: any, log: Logger) {
    this.log = log.child({ component: 'checkpoints_store' });
  }

  public async getMetadata(id: string): Promise<string | null> {
    const result = await this.prisma.metadata.findFirst({
      where: { id },
      select: {
        value: true
      }
    });

    if (!result || result.value.length == 0) {
      return null;
    }

    return result.value[0].value;
  }

  public async getMetadataNumber(id: string, base = 10): Promise<number | undefined> {
    const strValue = await this.getMetadata(id);
    if (!strValue) {
      return undefined;
    }

    return parseInt(strValue, base);
  }

  public async setMetadata(id: string, value: ToString): Promise<void> {
    await this.prisma.metadata.upsert({
      where: { id },
      update: {
        value: value.toString()
      },
      create: {
        id,
        value: value.toString()
      }
    });
  }

  public async insertCheckpoints(checkpoints: CheckpointRecord[]): Promise<void> {
    if (checkpoints.length === 0) {
      return;
    }

    await this.prisma.checkpoint.createMany({
      data: checkpoints.map(checkpoint => {
        const id = getCheckpointId(checkpoint.contractAddress, checkpoint.blockNumber);
        return {
          id,
          block_number: checkpoint.blockNumber,
          contract_address: checkpoint.contractAddress
        };
      }),
      skipDuplicates: true
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
    const result = await this.prisma.checkpoint.findMany({
      where: {
        block_number: {
          gte: block
        },
        contract_address: {
          in: contracts
        }
      },
      orderBy: {
        block_number: 'asc'
      },
      take: limit
    });

    this.log.debug({ result, block, contracts }, 'next checkpoint blocks');

    return result.map(value => Number(value.block_number));
  }
}
