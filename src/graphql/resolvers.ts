import { GraphQLField, GraphQLList, GraphQLObjectType } from 'graphql';
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

  const jsonFields = getJsonFields(info.returnType.ofType as GraphQLObjectType);

  if (args.where) {
    Object.entries(args.where).map(w => {
      whereSql += !whereSql ? `WHERE ` : ` AND `;
      let param = w[1];

      if (w[0].endsWith('_not')) {
        whereSql += `${w[0].slice(0, -4)} != ?`;
      } else if (w[0].endsWith('_gt')) {
        whereSql += `${w[0].slice(0, -3)} > ?`;
      } else if (w[0].endsWith('_gte')) {
        whereSql += `${w[0].slice(0, -4)} >= ?`;
      } else if (w[0].endsWith('_lt')) {
        whereSql += `${w[0].slice(0, -3)} < ?`;
      } else if (w[0].endsWith('_lte')) {
        whereSql += `${w[0].slice(0, -4)} <= ?`;
      } else if (w[0].endsWith('_not_contains')) {
        whereSql += `${w[0].slice(0, -13)} NOT LIKE ?`;
        param = `%${w[1]}%`;
      } else if (w[0].endsWith('_contains')) {
        whereSql += `${w[0].slice(0, -9)} LIKE ?`;
        param = `%${w[1]}%`;
      } else if (w[0].endsWith('_not_in')) {
        whereSql += `${w[0].slice(0, -7)} NOT IN (?)`;
      } else if (w[0].endsWith('_in')) {
        whereSql += `${w[0].slice(0, -3)} IN (?)`;
      } else {
        whereSql += `${w[0]} = ?`;
      }
      params.push(param);
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

  const result = await mysql.queryAsync(query, params);
  return result.map(item => formatItem(item, jsonFields));
}

export async function querySingle(parent, args, context: ResolverContext, info) {
  const { log, mysql } = context;

  const jsonFields = getJsonFields(info.returnType as GraphQLObjectType);

  const query = `SELECT * FROM ${info.fieldName}s WHERE id = ? LIMIT 1`;
  log.debug({ sql: query, args }, 'executing single query');

  const id = parent?.[info.fieldName] || args.id;
  const [item] = await mysql.queryAsync(query, [id]);
  return formatItem(item, jsonFields);
}

function getJsonFields(type: GraphQLObjectType) {
  return Object.values(type.getFields()).filter(field => field.type instanceof GraphQLList);
}

function formatItem(item: Record<string, any>, jsonFields: GraphQLField<any, any>[]) {
  const formatted = { ...item };

  jsonFields.forEach(field => {
    if (formatted[field.name]) {
      formatted[field.name] = JSON.parse(formatted[field.name]);
    }
  });

  return formatted;
}
