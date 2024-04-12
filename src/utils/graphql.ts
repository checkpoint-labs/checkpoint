import {
  GraphQLObjectType,
  GraphQLNonNull,
  isLeafType,
  isListType,
  GraphQLScalarType,
  GraphQLField
} from 'graphql';
import { jsonToGraphQLQuery } from 'json-to-graphql-query';
import pluralize from 'pluralize';

export const extendSchema = (schema: string): string => {
  return `directive @derivedFrom(field: String!) on FIELD_DEFINITION
${schema}`;
};

/**
 * Returns name of query for fetching single entity record
 *
 */
export const singleEntityQueryName = (entity: GraphQLObjectType) => entity.name.toLowerCase();

/**
 * Returns name of query for fetching multiple entity records
 *
 */
export const multiEntityQueryName = (entity: GraphQLObjectType) => {
  if (entity.name === '_Metadata') return '_metadatas';

  return pluralize(entity.name.toLowerCase());
};

/**
 * Generate sample query string based on entity object fields.
 *
 */
export const generateQueryForEntity = (entity: GraphQLObjectType): string => {
  // function to recursively build fields map
  const getObjectFields = (object: GraphQLObjectType, queryFields = {}): Record<string, any> => {
    const objectFields = object.getFields();

    Object.keys(objectFields).forEach(fieldName => {
      const rawFieldType = objectFields[fieldName].type;
      const fieldType = rawFieldType instanceof GraphQLNonNull ? rawFieldType.ofType : rawFieldType;

      if (isLeafType(fieldType)) {
        queryFields[fieldName] = true;
      } else if (isListType(fieldType)) {
        if (fieldType.ofType instanceof GraphQLScalarType) {
          queryFields[fieldName] = true;
        }
      } else {
        const childObjectFields = {};
        getObjectFields(fieldType as GraphQLObjectType, childObjectFields);
        queryFields[fieldName] = childObjectFields;
      }
    });

    return queryFields;
  };

  return jsonToGraphQLQuery(
    {
      query: {
        [multiEntityQueryName(entity)]: {
          __args: { first: 10 },
          ...getObjectFields(entity)
        }
      }
    },
    { pretty: true }
  );
};

export const getNonNullType = <T>(type: T): T => {
  if (type instanceof GraphQLNonNull) {
    return type.ofType;
  }

  return type;
};

export const getDerivedFromDirective = (field: GraphQLField<any, any>) => {
  const directives = field.astNode?.directives ?? [];
  return directives.find(dir => dir.name.value === 'derivedFrom');
};
