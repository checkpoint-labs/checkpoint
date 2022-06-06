import { GraphQLObjectType, isLeafType, isWrappingType } from 'graphql';
import { jsonToGraphQLQuery } from 'json-to-graphql-query';

/**
 * Returns name of query for fetching single entity record
 *
 */
export const singleEntityQueryName = (entity: GraphQLObjectType) => entity.name.toLowerCase();

/**
 * Returns name of query for fetching multiple entity records
 *
 */
export const multiEntityQueryName = (entity: GraphQLObjectType) => `${entity.name.toLowerCase()}s`;

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
      const fieldType = isWrappingType(rawFieldType) ? rawFieldType.ofType : rawFieldType;

      if (isLeafType(fieldType)) {
        queryFields[fieldName] = true;
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
