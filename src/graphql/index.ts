import { graphqlHTTP } from 'express-graphql';
import {
  GraphQLID,
  GraphQLInt,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString
} from 'graphql';
import { ResolverContext } from './resolvers';

/**
 * Creates an graphql http handler for the query passed a parameters.
 * Returned middleware can be used with express.
 */
export default function get(
  query: GraphQLObjectType,
  context: ResolverContext,
  sampleQuery?: string
) {
  const schema = new GraphQLSchema({ query });
  return graphqlHTTP({
    schema,
    context,
    graphiql: {
      defaultQuery: sampleQuery
    }
  });
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
