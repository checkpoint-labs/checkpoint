import knex from 'knex';
export type KnexType =
  | {
      name: 'integer' | 'bigint' | 'boolean' | 'text' | 'json';
    }
  | {
      name: 'decimal';
      options: [number, number];
    }
  | {
      name: 'float';
      options: [number];
    }
  | {
      name: 'string';
      options: [number];
    };

export default knex({
  client: 'mysql',
  connection: {
    host: '127.0.0.1',
    port: 3306,
    database: 'checkpoint',
    user: 'root',
    password: 'default_password',
    supportBigNumbers: true,
    bigNumberStrings: true
  }
});
