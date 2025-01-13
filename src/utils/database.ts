import pluralize from 'pluralize';
import { Knex } from 'knex';
import { INTERNAL_TABLES } from '../stores/checkpoints';

export type QueryFilter = {
  block?: number;
  indexer?: string;
};

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

export function applyQueryFilter(
  query: Knex.QueryBuilder,
  tableName: string,
  filters: QueryFilter
) {
  let filteredQuery = query;

  if (!INTERNAL_TABLES.includes(tableName)) {
    filteredQuery =
      filters.block !== undefined
        ? query.andWhereRaw(`${tableName}.block_range @> int8(??)`, [filters.block])
        : query.andWhereRaw(`upper_inf(${tableName}.block_range)`);
  }

  if (filters.indexer !== undefined) {
    filteredQuery = query.andWhere(`${tableName}.indexer`, filters.indexer);
  }

  return filteredQuery;
}
