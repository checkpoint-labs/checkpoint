import { GraphQLObjectType, GraphQLSchema, printSchema } from 'graphql';
import { mock } from 'jest-mock-extended';
import { GqlEntityController } from '../../../src/graphql/controller';
import { AsyncMySqlPool } from '../../../src/mysql';

describe('GqlEntityController', () => {
  describe('generateQueryFields', () => {
    it('should work', () => {
      const controller = new GqlEntityController(`
type Vote {
  id: Int!
  name: String
}
  `);
      const queryFields = controller.generateQueryFields();
      const querySchema = new GraphQLObjectType({
        name: 'Query',
        fields: queryFields
      });

      const schema = printSchema(new GraphQLSchema({ query: querySchema }));
      expect(schema).toMatchSnapshot();
    });

    // list of error table tests
    describe.each([
      {
        reason: 'non null object id',
        schema: `type Vote { id: String }`
      },
      {
        reason: 'object id is not scalar type',
        schema: `type Vote { id: Participant! }\n\n type Participant { id: Int! }`
      },
      {
        reason: 'object id is not scalar type 2',
        schema: `type Participant { id: [Int]! }`
      }
    ])('should fail for $reason', ({ schema }) => {
      const controller = new GqlEntityController(schema);
      expect(() => controller.generateQueryFields()).toThrowErrorMatchingSnapshot();
    });
  });

  describe('createEntityStores', () => {
    it('should work', async () => {
      const mockMysql = mock<AsyncMySqlPool>();
      const controller = new GqlEntityController(`
type Vote {
  id: Int!
  name: String
}
  `);
      await controller.createEntityStores(mockMysql);

      expect(mockMysql.queryAsync).toMatchSnapshot();
    });
  });

  describe('generateSampleQuery', () => {
    it('should return undefined when no entities are defined', () => {
      const controller = new GqlEntityController('scalar Text');

      expect(controller.generateSampleQuery()).toBeUndefined();
    });

    it.each([
      {
        case: 'first and only entity',
        schema: `
type Vote {
  id: Int!
  name: String
  created_at: Int!
}
        `
      },
      {
        case: 'nested objects',
        // Checkpoint doesn't support relationship among entities,
        // but this just tests to ensure the sample query works for it.
        schema: `
type Vote {
  id: Int!
  name: String
  poster: Poster
  created_at: Int!
}

type Poster {
  id: Int!
  name: String!
  venue: Venue!
}

type Venue {
  id: Int!
  location: String!
}
        `
      }
    ])('should return correct query sample for $case', ({ schema }) => {
      const controller = new GqlEntityController(schema);

      expect(controller.generateSampleQuery()).not.toBeUndefined();
      expect(controller.generateSampleQuery()).toMatchSnapshot();
    });
  });
});
