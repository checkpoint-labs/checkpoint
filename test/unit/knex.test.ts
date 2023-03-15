import { createKnexConfig } from '../../src/knex';

describe('createKnexConfig', () => {
  it('should create mysql config', () => {
    expect(createKnexConfig('mysql://root:default_password@localhost:3306/checkpoint')).toEqual({
      client: 'mysql',
      connection: {
        bigNumberStrings: true,
        database: 'checkpoint',
        host: 'localhost',
        password: 'default_password',
        port: 3306,
        ssl: undefined,
        supportBigNumbers: true,
        user: 'root'
      }
    });

    expect(createKnexConfig('postgres://root:default_password@localhost:3306/checkpoint')).toEqual({
      client: 'pg',
      connection: {
        database: 'checkpoint',
        host: 'localhost',
        password: 'default_password',
        port: 3306,
        ssl: undefined,
        user: 'root'
      }
    });
  });
});
