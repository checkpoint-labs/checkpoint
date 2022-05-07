import { AsyncMySqlPool } from '../mysql';
import { Logger } from '../utils/logger';

/**
 *
 */
export interface ResolverContext {
  log: Logger;
  mysql: AsyncMySqlPool;
}

export async function queryMulti(parent, args, context: ResolverContext, info) {
  const { log, mysql } = context;

  const params: any = [];
  let whereSql = '';
  if (args.where) {
    Object.entries(args.where).map(w => {
      whereSql += !whereSql ? `WHERE ${w[0]} = ? ` : ` AND ${w[0]} = ?`;
      params.push(w[1]);
    });
  }
  const first = args?.first || 1000;
  const skip = args?.skip || 0;

  let orderBySql = '';
  if (args.orderBy) {
    orderBySql = `ORDER BY ${args.orderBy} ${args.orderDirection || 'DESC'}`;
  }

  params.push(skip, first);

  const query = `SELECT * FROM ${info.fieldName} ${whereSql} ${orderBySql} LIMIT ?, ?`;
  log.debug({ sql: query, args }, 'executing multi query');

  return await mysql.queryAsync(query, params);
}

export async function querySingle(parent, args, context: ResolverContext, info) {
  const { log, mysql } = context;

  const query = `SELECT * FROM ${info.fieldName}s WHERE id = ? LIMIT 1`;
  log.debug({ sql: query, args }, 'executing single query');

  const [item] = await mysql.queryAsync(query, [args.id]);
  return item;
}
