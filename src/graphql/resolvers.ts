import {
  GraphQLField,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLResolveInfo,
  GraphQLScalarType,
  isListType
} from 'graphql';
import {
  parseResolveInfo,
  simplifyParsedResolveInfoFragmentWithType
} from 'graphql-parse-resolve-info';
import pluralize from 'pluralize';
import { AsyncMySqlPool } from '../mysql';
import { getNonNullType } from '../utils/graphql';
import { Logger } from '../utils/logger';
import type DataLoader from 'dataloader';

export type ResolverContextInput = {
  log: Logger;
  mysql: AsyncMySqlPool;
};

export type ResolverContext = ResolverContextInput & {
  getLoader: (name: string, field?: string) => DataLoader<readonly unknown[], any>;
};

export async function queryMulti(parent, args, context: ResolverContext, info) {
  const { log, mysql } = context;
  const params: any = [];
  let whereSql = '';

  const returnType = info.returnType.ofType as GraphQLObjectType;
  const jsonFields = getJsonFields(returnType);

  if (args.where) {
    Object.entries(args.where).map(w => {
      whereSql += !whereSql ? `WHERE ` : ` AND `;
      let param = w[1];

      if (w[0].endsWith('_not')) {
        whereSql += `\`${w[0].slice(0, -4)}\` != ?`;
      } else if (w[0].endsWith('_gt')) {
        whereSql += `\`${w[0].slice(0, -3)}\` > ?`;
      } else if (w[0].endsWith('_gte')) {
        whereSql += `\`${w[0].slice(0, -4)}\` >= ?`;
      } else if (w[0].endsWith('_lt')) {
        whereSql += `\`${w[0].slice(0, -3)}\` < ?`;
      } else if (w[0].endsWith('_lte')) {
        whereSql += `\`${w[0].slice(0, -4)}\` <= ?`;
      } else if (w[0].endsWith('_not_contains')) {
        whereSql += `\`${w[0].slice(0, -13)}\` NOT LIKE ?`;
        param = `%${w[1]}%`;
      } else if (w[0].endsWith('_contains')) {
        whereSql += `\`${w[0].slice(0, -9)}\` LIKE ?`;
        param = `%${w[1]}%`;
      } else if (w[0].endsWith('_not_in')) {
        whereSql += `\`${w[0].slice(0, -7)}\` NOT IN (?)`;
      } else if (w[0].endsWith('_in')) {
        whereSql += `\`${w[0].slice(0, -3)}\` IN (?)`;
      } else {
        whereSql += `\`${w[0]}\` = ?`;
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

  const query = `SELECT * FROM ${pluralize(
    returnType.name.toLowerCase()
  )} ${whereSql} ${orderBySql} LIMIT ?, ?`;
  log.debug({ sql: query, args }, 'executing multi query');

  const result = await mysql.queryAsync(query, params);
  return result.map(item => formatItem(item, jsonFields));
}

export async function querySingle(
  parent,
  args,
  context: ResolverContext,
  info: GraphQLResolveInfo
) {
  const returnType = getNonNullType(info.returnType) as GraphQLObjectType;
  const jsonFields = getJsonFields(returnType);

  const id = parent?.[info.fieldName] || args.id;

  const parsed = parseResolveInfo(info);
  if (parsed) {
    // @ts-ignore
    const simplified = simplifyParsedResolveInfoFragmentWithType(parsed, returnType);

    if (Object.keys(simplified.fields).length === 1 && simplified.fields['id']) {
      return { id };
    }
  }

  const items = await context.getLoader(returnType.name.toLowerCase()).load(id);
  if (items.length === 0) {
    throw new Error(`Row not found: ${id}`);
  }

  return formatItem(items[0], jsonFields);
}

export const getNestedResolver = (columnName: string) =>
  async function queryNested(parent, args, context: ResolverContext, info: GraphQLResolveInfo) {
    const returnType = getNonNullType(info.returnType) as GraphQLList<GraphQLObjectType>;
    const jsonFields = getJsonFields(returnType.ofType);

    const parentType = getNonNullType(info.parentType) as GraphQLObjectType;
    const field = parentType.getFields()[info.fieldName];

    const fieldType =
      info.returnType instanceof GraphQLNonNull ? info.returnType.ofType : info.returnType;
    if (!isListType(fieldType)) return [];

    const directives = field.astNode?.directives ?? [];
    const derivedFromDirective = directives.find(dir => dir.name.value === 'derivedFrom');
    if (!derivedFromDirective) {
      throw new Error(`field ${field.name} is missing derivedFrom directive`);
    }
    const fieldArgument = derivedFromDirective.arguments?.find(arg => arg.name.value === 'field');
    if (!fieldArgument || fieldArgument.value.kind !== 'StringValue') {
      throw new Error(`field ${field.name} is missing field in derivedFrom directive`);
    }

    const result = await context.getLoader(columnName, fieldArgument.value.value).load(parent.id);
    return result.map(item => formatItem(item, jsonFields));
  };

function getJsonFields(type: GraphQLObjectType) {
  return Object.values(type.getFields()).filter(
    field => isListType(field.type) && field.type.ofType instanceof GraphQLScalarType
  );
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
