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
import { Knex } from 'knex';
import { Pool as PgPool } from 'pg';
import { AsyncMySqlPool } from '../mysql';
import { getNonNullType } from '../utils/graphql';
import { getTableName } from '../utils/database';
import { Logger } from '../utils/logger';
import type DataLoader from 'dataloader';

export type ResolverContextInput = {
  log: Logger;
  knex: Knex;
  mysql: AsyncMySqlPool;
  pg: PgPool;
};

export type ResolverContext = ResolverContextInput & {
  getLoader: (name: string, field?: string) => DataLoader<readonly unknown[], any>;
};

export async function queryMulti(parent, args, context: ResolverContext, info) {
  const { log, knex } = context;

  const returnType = info.returnType.ofType as GraphQLObjectType;
  const jsonFields = getJsonFields(returnType);

  const tableName = getTableName(returnType.name.toLowerCase());

  let query = knex.select('*').from(tableName);

  if (args.where) {
    Object.entries(args.where).map((w: [string, any]) => {
      // TODO: we could generate args.where as objects { name, column, operator, value }
      // so we don't have to cut it there
      if (w[0].endsWith('_not')) {
        query = query.where(w[0].slice(0, -4), '!=', w[1]);
      } else if (w[0].endsWith('_gt')) {
        query = query.where(w[0].slice(0, -3), '>', w[1]);
      } else if (w[0].endsWith('_gte')) {
        query = query.where(w[0].slice(0, -4), '>=', w[1]);
      } else if (w[0].endsWith('_lt')) {
        query = query.where(w[0].slice(0, -3), '<', w[1]);
      } else if (w[0].endsWith('_lte')) {
        query = query.where(w[0].slice(0, -4), '<=', w[1]);
      } else if (w[0].endsWith('_not_contains')) {
        query = query.not.whereLike(w[0].slice(0, -13), `%${w[1]}%`);
      } else if (w[0].endsWith('_not_contains_nocase')) {
        query = query.not.whereILike(w[0].slice(0, -20), `%${w[1]}%`);
      } else if (w[0].endsWith('_contains')) {
        query = query.whereLike(w[0].slice(0, -9), `%${w[1]}%`);
      } else if (w[0].endsWith('_contains_nocase')) {
        query = query.whereILike(w[0].slice(0, -16), `%${w[1]}%`);
      } else if (w[0].endsWith('_not_in')) {
        query = query.not.whereIn(w[0].slice(0, -7), w[1]);
      } else if (w[0].endsWith('_in')) {
        query = query.whereIn(w[0].slice(0, -3), w[1] as any);
      } else {
        query = query.where(w[0], w[1]);
      }
    });
  }

  if (args.orderBy) {
    query = query.orderBy(args.orderBy, args.orderDirection?.toLowerCase() || 'desc');
  }

  query = query.limit(args?.first || 1000).offset(args?.skip || 0);
  log.debug({ sql: query.toQuery(), args }, 'executing multi query');

  const result = await query;
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
    if (typeof formatted[field.name] === 'string') {
      formatted[field.name] = JSON.parse(formatted[field.name]);
    }
  });

  return formatted;
}
