import {
  buildSchema,
  GraphQLEnumType,
  GraphQLField,
  GraphQLFieldConfig,
  GraphQLFieldConfigMap,
  GraphQLFieldResolver,
  GraphQLFloat,
  GraphQLID,
  GraphQLInputObjectType,
  GraphQLInputObjectTypeConfig,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLOutputType,
  GraphQLScalarType,
  GraphQLSchema,
  GraphQLString,
  isLeafType,
  Source
} from 'graphql';
import { AsyncMySqlPool } from '../mysql';
import {
  generateQueryForEntity,
  multiEntityQueryName,
  singleEntityQueryName
} from '../utils/graphql';
import { querySingle, queryMulti, ResolverContext } from './resolvers';

/**
 * Type for single and multiple query resolvers
 */
interface EntityQueryResolvers<Context = ResolverContext> {
  singleEntityResolver: GraphQLFieldResolver<unknown, Context>;
  multipleEntityResolver: GraphQLFieldResolver<unknown, Context>;
}

const GraphQLOrderDirection = new GraphQLEnumType({
  name: 'OrderDirection',
  values: {
    asc: { value: 'ASC' },
    desc: { value: 'DESC' }
  }
});

/**
 * Controller for performing actions based on the graphql schema provided to its
 * constructor. It exposes public functions to generate graphql or database
 * items based on the entities identified in the schema.
 *
 * Note: Entities refer to Object types with an `id` field defined within the
 * graphql schema.
 */
export class GqlEntityController {
  private readonly schema: GraphQLSchema;
  private _schemaObjects?: GraphQLObjectType[];

  constructor(typeDefs: string | Source) {
    this.schema = buildSchema(typeDefs);
  }

  /**
   * Creates a grqphql Query object generated from the objects defined within
   * the schema.
   * For each of the objects, two queries are created, one for querying the object
   * by it's id and the second for querying multiple objects based on a couple
   * of parameters.
   *
   * For example, given the input schema:
   * ```
   * type Vote {
   *  id: Int!
   *  name: String
   * }
   * ```
   *
   * The generated queries will be like:
   * ```
   * type Query {
   *  votes(
   *     first: Int
   *     skip: Int
   *     orderBy: String
   *     orderDirection: String
   *     where: WhereVote
   *   ): [Vote]
   *   vote(id: Int!): Vote
   * }
   *
   *  input WhereVote {
   *    id: Int
   *    id_in: [Int]
   *    name: String
   *    name_in: [String]
   *  }
   *
   * ```
   *
   */
  public generateQueryFields(
    schemaObjects?: GraphQLObjectType[],
    resolvers: EntityQueryResolvers = {
      singleEntityResolver: querySingle,
      multipleEntityResolver: queryMulti
    }
  ): GraphQLFieldConfigMap<any, any> {
    schemaObjects = schemaObjects || this.schemaObjects;

    const queryFields: GraphQLFieldConfigMap<any, any> = {};

    schemaObjects.forEach(type => {
      queryFields[singleEntityQueryName(type)] = this.getSingleEntityQueryConfig(
        type,
        resolvers.singleEntityResolver
      );
      queryFields[multiEntityQueryName(type)] = this.getMultipleEntityQueryConfig(
        type,
        resolvers.multipleEntityResolver
      );
    });

    return queryFields;
  }

  /**
   * Creates store for each of the objects in the schema.
   * For now, it only creates mysql tables for each of the objects.
   * It also creates a checkpoint table to track checkpoints visited.
   *
   * For example, given an schema like:
   * ```graphql
   * type Vote {
   *  id: Int!
   *  name: String
   * }
   * ```
   *
   * will execute the following SQL:
   * ```sql
   * DROP TABLE IF EXISTS votes;
   * CREATE TABLE votes (
   *   id VARCHAR(128) NOT NULL,
   *   name VARCHAR(128),
   *   PRIMARY KEY (id) ,
   *   INDEX id (id),
   *   INDEX name (name)
   * );
   * ```
   *
   */
  public async createEntityStores(mysql: AsyncMySqlPool): Promise<void> {
    if (this.schemaObjects.length === 0) {
      return;
    }

    let sql = '';
    this.schemaObjects.forEach(type => {
      sql += `\n\nDROP TABLE IF EXISTS ${type.name.toLowerCase()}s;`;
      sql += `\nCREATE TABLE ${type.name.toLowerCase()}s (`;
      let sqlIndexes = ``;

      this.getTypeFields(type).forEach(field => {
        const sqlType = this.getSqlType(field.type);

        sql += `\n  ${field.name} ${sqlType}`;
        if (field.type instanceof GraphQLNonNull) {
          sql += ' NOT NULL,';
        } else {
          sql += ',';
        }

        if (sqlType !== 'TEXT') {
          sqlIndexes += `,\n  INDEX ${field.name} (${field.name})`;
        }
      });
      sql += `\n  PRIMARY KEY (id) ${sqlIndexes}\n);\n`;
    });

    // TODO(perfectmak): wrap this in a transaction
    return mysql.queryAsync(sql.trimEnd());
  }

  /**
   * Generates a query based on the first entity discovered
   * in a schema. If no entities are found in the schema
   * it returns undefined.
   *
   */
  public generateSampleQuery(): string | undefined {
    if (this.schemaObjects.length === 0) {
      return undefined;
    }

    const firstEntityQuery = generateQueryForEntity(this.schemaObjects[0]);
    const queryComment = `
# Welcome to Checkpoint. Try running the below example query from 
# your defined entity.
    `;
    return `${queryComment}\n${firstEntityQuery}`;
  }

  /**
   * Returns a list of objects defined within the graphql typedefs.
   * The types returns are introspection objects, that can be used
   * for inspecting the fields and types.
   *
   * Note: that the returned objects does not include the Query object type if defined.
   *
   */
  private get schemaObjects(): GraphQLObjectType[] {
    if (this._schemaObjects) {
      return this._schemaObjects;
    }

    this._schemaObjects = Object.values(this.schema.getTypeMap()).filter(type => {
      return (
        type instanceof GraphQLObjectType && type.name != 'Query' && !type.name.startsWith('__')
      );
    }) as GraphQLObjectType[];

    return this._schemaObjects;
  }

  private getTypeFields<Parent, Context>(
    type: GraphQLObjectType<Parent, Context>
  ): GraphQLField<Parent, Context>[] {
    return Object.values(type.getFields());
  }

  private getSingleEntityQueryConfig<Parent, Context>(
    type: GraphQLObjectType,
    resolver: GraphQLFieldResolver<Parent, Context>
  ): GraphQLFieldConfig<Parent, Context> {
    return {
      type,
      args: {
        id: { type: new GraphQLNonNull(this.getEntityIdType(type)) }
      },
      resolve: resolver
    };
  }

  private getMultipleEntityQueryConfig<Parent, Context>(
    type: GraphQLObjectType,
    resolver: GraphQLFieldResolver<Parent, Context>
  ): GraphQLFieldConfig<Parent, Context> {
    const whereInputConfig: GraphQLInputObjectTypeConfig = {
      name: `Where${type.name}`,
      fields: {}
    };

    const orderByValues = {};

    this.getTypeFields(type).forEach(field => {
      // all field types in a where input variable must be optional
      // so we try to extract the non null type here.
      const nonNullFieldType = this.getNonNullType(field.type);

      // avoid setting up where filters for non scalar types
      if (!isLeafType(nonNullFieldType)) {
        return;
      }

      if (nonNullFieldType === GraphQLInt) {
        whereInputConfig.fields[`${field.name}_gt`] = { type: GraphQLInt };
        whereInputConfig.fields[`${field.name}_gte`] = { type: GraphQLInt };
        whereInputConfig.fields[`${field.name}_lt`] = { type: GraphQLInt };
        whereInputConfig.fields[`${field.name}_lte`] = { type: GraphQLInt };
      }

      if ((nonNullFieldType as GraphQLScalarType).name !== 'Text') {
        whereInputConfig.fields[`${field.name}`] = { type: nonNullFieldType };
        whereInputConfig.fields[`${field.name}_in`] = {
          type: new GraphQLList(nonNullFieldType)
        };
      }

      // add fields to orderBy enum
      orderByValues[field.name] = { value: field.name };
    });

    const OrderByEnum = new GraphQLEnumType({
      name: `OrderBy${type.name}Fields`,
      values: orderByValues
    });

    return {
      type: new GraphQLList(type),
      args: {
        first: {
          type: GraphQLInt
        },
        skip: {
          type: GraphQLInt
        },
        orderBy: {
          type: OrderByEnum
        },
        orderDirection: {
          type: GraphQLOrderDirection
        },
        where: { type: new GraphQLInputObjectType(whereInputConfig) }
      },
      resolve: resolver
    };
  }

  private getEntityIdType(type: GraphQLObjectType): GraphQLScalarType {
    const idField = type.getFields().id;
    if (!idField) {
      throw new Error(
        `'id' field is missing in type '${type.name}'. All types are required to have an id field.`
      );
    }

    if (!(idField.type instanceof GraphQLNonNull)) {
      throw new Error(`'id' field for type ${type.name} must be non nullable.`);
    }

    const nonNullType = idField.type.ofType;

    // verify only scalar types are used
    if (!(nonNullType instanceof GraphQLScalarType)) {
      throw new Error(`'id' field for type ${type.name} is not a scalar type.`);
    }

    return nonNullType;
  }

  private getNonNullType(type: GraphQLOutputType): GraphQLOutputType {
    if (type instanceof GraphQLNonNull) {
      return type.ofType;
    }

    return type;
  }

  /**
   * Return a mysql column type for the graphql type.
   *
   * It throws if the type is not a recognized scalar type.
   */
  private getSqlType(type: GraphQLOutputType): string {
    if (type instanceof GraphQLNonNull) {
      type = type.ofType;
    }

    switch (type) {
      case GraphQLInt:
        return 'INT(128)';
      case GraphQLFloat:
        return 'FLOAT(23)';
      case GraphQLString:
      case GraphQLID:
        return 'VARCHAR(128)';
    }

    // check for TEXT scalar type
    if (type instanceof GraphQLScalarType && type.name === 'Text') {
      return 'TEXT';
    }

    // TODO(perfectmak): Add support for List types

    throw new Error(`sql type for ${type} not support`);
  }
}
