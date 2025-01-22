import { Knex } from 'knex';

function createRegister() {
  let knexInstance: Knex | null = null;
  const currentBlocks = new Map<string, bigint>();

  return {
    getCurrentBlock(indexerName: string) {
      return currentBlocks.get(indexerName) || 0n;
    },
    setCurrentBlock(indexerName: string, block: bigint) {
      currentBlocks.set(indexerName, block);
    },
    getKnex() {
      if (!knexInstance) {
        throw new Error('Knex is not initialized yet.');
      }

      return knexInstance;
    },
    setKnex(knex: Knex) {
      knexInstance = knex;
    }
  };
}

export const register = createRegister();
