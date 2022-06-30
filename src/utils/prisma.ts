import { GraphQLObjectType, GraphQLField } from 'graphql';

export const transformEntityObjectsToPrismaSchema = async (
  entities: GraphQLObjectType[]
): Promise<string> => {
  const models: string[] = [];
  for (const entity of entities) {
    let model = `model ${entity.name} {\n`;

    Object.values(entity.getFields()).forEach(field => {
      model += `${transformEntityFieldToPrismaSchema(field)}\n`;
    });
    model += '}';
    models.push(model);
  }

  return models.join('\n\n');
};

const transformEntityFieldToPrismaSchema = async (
  field: GraphQLField<any, any>
): Promise<string> => {
  // algorithms:
  //
  // map unwrapped graphql type to prisma type
  //
  // if type is a list and scalar type
  // make the type a list type
  //
  // else include a relationships directive in the prisma schema
  // the foreign key should be the id (think more about this).
  return '';
};
