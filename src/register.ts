import { Knex } from 'knex';

function createRegister() {
  let knexInstance: Knex | null = null;

  return {
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
