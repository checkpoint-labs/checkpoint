import mysql, { PoolConfig, Pool as PoolType, QueryOptions } from 'mysql';
import Pool from 'mysql/lib/Pool';
import Connection from 'mysql/lib/Connection';
import bluebird from 'bluebird';
import { ConnectionString } from 'connection-string';

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
 * Attempts to connect to the database by the connection string. If no connection string
 * argument is provided, it tries to use the `DATABASE_URL` environment variable
 * as connection string.
 *
 * This returns a mysql pool connection object.
 */
export const createMySqlPool = (connection?: string): AsyncMySqlPool => {
  if (!connection && !process.env.DATABASE_URL) {
    throw new Error(
      'a valid connection string or DATABASE_URL environment variable is required to connect to the database'
    );
  }

  const connectionConfig = new ConnectionString((connection || process.env.DATABASE_URL) as string);
  if (!connectionConfig.hosts || !connectionConfig.path) {
    throw new Error('invalid mysql connection string provided');
  }

  const config: PoolConfig = {
    connectionLimit: 1,
    multipleStatements: true,
    database: connectionConfig.path[0],
    user: connectionConfig.user,
    password: connectionConfig.password,
    host: connectionConfig.hosts[0].name,
    port: connectionConfig.hosts[0].port,
    connectTimeout: 30000, // 30 seconds
    charset: 'utf8mb4'
  };

  return mysql.createPool(config) as AsyncMySqlPool;
};
