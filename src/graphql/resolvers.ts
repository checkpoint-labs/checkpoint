import { AsyncMySqlPool } from '../mysql';
import { Logger } from '../utils/logger';

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
      whereSql += !whereSql ? `WHERE ` : ` AND `;

      if (w[0].endsWith('_not')) {
        whereSql += `${w[0].slice(0, -4)} != ?`;
        params.push(w[1]);
      } else if (w[0].endsWith('_gt')) {
        whereSql += `${w[0].slice(0, -3)} > ?`;
        params.push(w[1]);
      } else if (w[0].endsWith('_gte')) {
        whereSql += `${w[0].slice(0, -4)} >= ?`;
        params.push(w[1]);
      } else if (w[0].endsWith('_lt')) {
        whereSql += `${w[0].slice(0, -3)} < ?`;
        params.push(w[1]);
      } else if (w[0].endsWith('_lte')) {
        whereSql += `${w[0].slice(0, -4)} <= ?`;
        params.push(w[1]);
      } else if (w[0].endsWith('_not_contains')) {
        whereSql += `${w[0].slice(0, -13)} NOT LIKE ?`;
        params.push(`%${w[1]}%`);
      } else if (w[0].endsWith('_contains')) {
        whereSql += `${w[0].slice(0, -9)} LIKE ?`;
        params.push(`%${w[1]}%`);
      } else if (w[0].endsWith('_not_in')) {
        whereSql += `${w[0].slice(0, -7)} NOT IN (?)`;
        params.push(w[1]);
      } else if (w[0].endsWith('_in')) {
        whereSql += `${w[0].slice(0, -3)} IN (?)`;
        params.push(w[1]);
      } else {
        whereSql += `${w[0]} = ?`;
        params.push(w[1]);
      }
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
