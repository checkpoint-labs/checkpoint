import { Pool } from 'pg';
import { getConnectionData } from './knex';

/**
 * Attempts to connect to the database by the connection string.
 *
 * This returns a pg pool connection object.
 */
export const createPgPool = (connectionString: string): Pool => {
  const { connection } = getConnectionData(connectionString);

  const config = {
    ...connection,
    connectionTimeoutMillis: 30000 // 30 seconds
  };

  return new Pool(config);
};
