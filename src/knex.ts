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

export function createKnexConfig(connection: string): Knex.Config {
  if (
    connection.endsWith('.sqlite') ||
    connection.endsWith('.sqlite3') ||
    connection.endsWith('.db')
  ) {
    return {
      client: 'sqlite3',
      connection: {
        filename: connection
      },
      useNullAsDefault: true
    };
  }

  const connectionConfig = new ConnectionString(connection);
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

export function createKnex(config: string | Knex.Config) {
  const parsedConfig = typeof config === 'string' ? createKnexConfig(config) : config;

  return knex(parsedConfig);
}
