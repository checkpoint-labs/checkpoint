import mysql from 'mysql';
import { createMySqlPool } from '../../src/mysql';

jest.mock('mysql');

describe('createMySqlPool()', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('should throw if no string or environment variable', () => {
    process.env.DATABASE_URL = undefined;

    expect(() => createMySqlPool()).toThrowErrorMatchingSnapshot();
  });

  it('should use environment variables to create connection', () => {
    process.env.DATABASE_URL = 'mysql://root:pass@localhost:3306/env_db';

    createMySqlPool();

    expect(mysql.createPool).toMatchSnapshot();
  });

  it('should use argument string to create connection', () => {
    const connection = 'mysql://root:pass@localhost:3306/string_db';

    createMySqlPool(connection);

    expect(mysql.createPool).toMatchSnapshot();
  });
});
