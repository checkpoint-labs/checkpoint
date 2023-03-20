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

  it('should use argument string to create connection', () => {
    const connection = 'mysql://root:pass@localhost:3306/string_db';

    createMySqlPool(connection);

    expect(mysql.createPool).toMatchSnapshot();
  });
});
