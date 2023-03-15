import { graphqlHTTP } from 'express-graphql';
import {
  GraphQLID,
  GraphQLInt,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString
} from 'graphql';
import DataLoader from 'dataloader';
import { ResolverContextInput } from './resolvers';
import { getTableName } from '../utils/database';

/**
 * Creates getLoader function that will return existing, or create a new dataloader
 * for specific entity.
 * createGetLoader should be called per-request so each request has its own caching
 * and batching.
 */
export const createGetLoader = (context: ResolverContextInput) => {
  const loaders = {};

  return (name: string, field = 'id') => {
    const key = `${name}-${field}`;

    if (!loaders[key]) {
      loaders[key] = new DataLoader(async ids => {
        const query = context.knex
          .select('*')
          .from(getTableName(name))
          .whereIn(field, ids as string[]);

        context.log.debug({ sql: query.toQuery(), ids }, 'executing batched query');

        const results = await query;
        const resultsMap = results.reduce((acc, result) => {
          if (!acc[result[field]]) acc[result[field]] = [];

          acc[result[field]].push(result);

          return acc;
        }, {});

        return ids.map((id: any) => resultsMap[id] || []);
      });
    }

    return loaders[key];
  };
};

/**
 * Creates an graphql http handler for the query passed a parameters.
 * Returned middleware can be used with express.
 */
export default function get(
  schema: GraphQLSchema,
  context: ResolverContextInput,
  sampleQuery?: string
) {
  return graphqlHTTP(() => ({
    schema,
    context: {
      ...context,
      getLoader: createGetLoader(context)
    },
    graphiql: {
      defaultQuery: sampleQuery
    }
  }));
}

/**
 * This objects name and field maps to the values of the _metadata
 * database store
 *
 */
export const MetadataGraphQLObject = new GraphQLObjectType({
  name: '_Metadata',
  description: 'Core metadata values used internally by Checkpoint',
  fields: {
    id: { type: new GraphQLNonNull(GraphQLID), description: 'example: last_indexed_block' },
    value: { type: GraphQLString }
  }
});

/**
 * This objects name and field maps to the values of the _checkpoints
 * database store. And is used to generate entity queries for graphql
 *
 */
export const CheckpointsGraphQLObject = new GraphQLObjectType({
  name: '_Checkpoint',
  description: 'Contract and Block where its event is found.',
  fields: {
    id: {
      type: new GraphQLNonNull(GraphQLID),
      description: 'id computed as last 5 bytes of sha256(contract+block)'
    },
    block_number: {
      type: new GraphQLNonNull(GraphQLInt)
    },
    contract_address: {
      type: new GraphQLNonNull(GraphQLString)
    }
  }
});
