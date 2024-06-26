import pluralize from 'pluralize';
import { Knex } from 'knex';
import { INTERNAL_TABLES } from '../stores/checkpoints';

export const getTableName = (name: string) => {
  if (name === '_metadata') return '_metadatas';

  return pluralize(name);
};

export function applyBlockFilter(query: Knex.QueryBuilder, tableName: string, block?: number) {
  if (INTERNAL_TABLES.includes(tableName)) return query;

  return block !== undefined
    ? query.andWhereRaw(`${tableName}.block_range @> int8(??)`, [block])
    : query.andWhereRaw(`upper_inf(${tableName}.block_range)`);
}
