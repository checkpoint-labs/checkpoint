import knex, { Knex } from 'knex';
import { ConnectionString } from 'connection-string';

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

const PROTOCOLS = {
  mysql: 'mysql',
  postgres: 'pg'
};

const EXTRA_OPTIONS = {
  mysql: {
    supportBigNumbers: true,
    bigNumberStrings: true
  }
};

export function getConnectionData(connectionString: string) {
  const connectionConfig = new ConnectionString(connectionString);
  if (!connectionConfig.protocol || !connectionConfig.hosts || !connectionConfig.path) {
    throw new Error('invalid connection string provided');
  }

  const client = PROTOCOLS[connectionConfig.protocol];
  if (!client) {
    throw new Error(`Supplied protocol ${connectionConfig.protocol} is not supported`);
  }

  return {
    client,
    connection: {
      database: connectionConfig.path[0],
      user: connectionConfig.user,
      password: connectionConfig.password,
      host: connectionConfig.hosts[0].name,
      port: connectionConfig.hosts[0].port,
      ssl:
        connectionConfig.params?.sslaccept === 'strict' ||
        connectionConfig.params?.ssl === 'rejectUnauthorized'
          ? {
              rejectUnauthorized: true
            }
          : undefined,
      ...EXTRA_OPTIONS[client]
    }
  };
}

export function createKnexConfig(connectionString: string): Knex.Config {
  return getConnectionData(connectionString);
}

export function createKnex(config: string | Knex.Config) {
  const parsedConfig = typeof config === 'string' ? createKnexConfig(config) : config;

  return knex(parsedConfig);
}
