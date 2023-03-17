import mysql, { PoolConfig, Pool as PoolType, QueryOptions } from 'mysql';
import Pool from 'mysql/lib/Pool';
import Connection from 'mysql/lib/Connection';
import { getConnectionData } from './knex';
import bluebird from 'bluebird';

bluebird.promisifyAll([Pool, Connection]);

/**
 * Type definition for the promisified Pool type.
 *
 * This has to be updated manually with new promisified methods
 * that users will like to access.
 */
export interface AsyncMySqlPool extends PoolType {
  queryAsync: (options: string | QueryOptions, values?: any) => Promise<any>;
}

/**
 * Attempts to connect to the database by the connection string.
 *
 * This returns a mysql pool connection object.
 */
export const createMySqlPool = (connectionString: string): AsyncMySqlPool => {
  const { connection } = getConnectionData(connectionString);

  const config: PoolConfig = {
    ...connection,
    multipleStatements: true,
    connectTimeout: 30000, // 30 seconds
    charset: 'utf8mb4'
  };

  return mysql.createPool(config) as AsyncMySqlPool;
};
