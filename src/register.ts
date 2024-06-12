import { Knex } from 'knex';

function createRegister() {
  let knexInstance: Knex | null = null;
  let currentBlock = 0n;

  return {
    getCurrentBlock() {
      return currentBlock;
    },
    setCurrentBlock(block: bigint) {
      currentBlock = block;
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
