import {
  GraphQLField,
  GraphQLFloat,
  GraphQLID,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLScalarType,
  GraphQLString,
  GraphQLType,
  isListType
} from 'graphql';
import pluralize from 'pluralize';
import { GqlEntityController } from './graphql/controller';
import { extendSchema } from './utils/graphql';

export const getInitialValue = (field: GraphQLField<any, any>) => {
  if (!(field.type instanceof GraphQLNonNull)) {
    return null;
  }

  const nonNullType = field.type.ofType;

  switch (nonNullType) {
    case GraphQLInt:
    case GraphQLFloat:
      return 0;
    case GraphQLString:
    case GraphQLID:
      return '';
  }

  if (field instanceof GraphQLScalarType) {
    switch (field.name) {
      case 'BigInt':
        return 0;
      case 'Boolean':
        return false;
      case 'Text':
        return '';
      default:
        // TODO: handle decimal types - currently decimal types are defined
        // in options so we don't have access from codegen
        return '0';
    }
  }

  if (field instanceof GraphQLList) {
    return [];
  }

  return null;
};

export const getBaseType = (type: GraphQLType) => {
  switch (type) {
    case GraphQLInt:
    case GraphQLFloat:
      return 'number';
    case GraphQLString:
    case GraphQLID:
      return 'string';
  }

  if (type instanceof GraphQLObjectType) {
    return 'string';
  }

  if (type instanceof GraphQLScalarType) {
    switch (type.name) {
      case 'BigInt':
        return 'bigint';
      case 'Boolean':
        return 'boolean';
      case 'Text':
        return 'string';
      default:
        // TODO: handle decimal types - currently decimal types are defined
        // in options so we don't have access from codegen, we just assume string
        return 'string';
    }
  }

  if (type instanceof GraphQLList) {
    const nonNullType = type.ofType instanceof GraphQLNonNull ? type.ofType.ofType : type.ofType;
    return `${getBaseType(nonNullType)}[]`;
  }

  return null;
};

export const getJSType = (field: GraphQLField<any, any>) => {
  const nonNullType = field.type instanceof GraphQLNonNull ? field.type.ofType : field.type;
  const isNullable = !(field.type instanceof GraphQLNonNull);
  const isList = nonNullType instanceof GraphQLList;
  const baseType = getBaseType(nonNullType);

  return { isNullable, isList, baseType };
};

export const codegen = (schema: string) => {
  const extendedSchema = extendSchema(schema);
  const controller = new GqlEntityController(extendedSchema);

  const preamble = `import { Model } from '@snapshot-labs/checkpoint';\n\n`;

  let contents = `${preamble}`;

  controller.schemaObjects.forEach((type, i, arr) => {
    const modelName = type.name;

    contents += `export class ${modelName} extends Model {\n`;
    contents += `  static tableName = '${pluralize(modelName.toLowerCase())}';\n\n`;

    contents += `  constructor(id: string) {\n`;
    contents += `    super(${modelName}.tableName);\n\n`;
    controller.getTypeFields(type).forEach(field => {
      const fieldType = field.type instanceof GraphQLNonNull ? field.type.ofType : field.type;
      if (isListType(fieldType) && fieldType.ofType instanceof GraphQLObjectType) {
        return;
      }

      const initialValue = field.name === 'id' ? 'id' : JSON.stringify(getInitialValue(field));
      contents += `    this.initialSet('${field.name}', ${initialValue});\n`;
    });
    contents += `  }\n\n`;

    contents += `  static async loadEntity(id: string): Promise<${modelName} | null> {\n`;
    contents += `    const entity = await super.loadEntity(${modelName}.tableName, id);\n`;
    contents += `    if (!entity) return null;\n\n`;
    contents += `    const model = new ${modelName}(id);\n`;
    contents += `    model.setExists();\n\n`;
    contents += `    for (const key in entity) {\n`;
    contents += `      model.set(key, entity[key]);\n`;
    contents += `    }\n\n`;
    contents += `    return model;\n`;
    contents += `  }\n\n`;

    controller.getTypeFields(type).forEach(field => {
      const fieldType = field.type instanceof GraphQLNonNull ? field.type.ofType : field.type;
      if (isListType(fieldType) && fieldType.ofType instanceof GraphQLObjectType) {
        return;
      }

      const { isNullable, isList, baseType } = getJSType(field);
      const typeAnnotation = isNullable ? `${baseType} | null` : baseType;

      contents += `  get ${field.name}(): ${typeAnnotation} {\n`;
      contents += `    return ${
        isList ? `JSON.parse(this.get('${field.name}'))` : `this.get('${field.name}')`
      };\n`;
      contents += `  }\n\n`;

      contents += `  set ${field.name}(value: ${typeAnnotation}) {\n`;
      contents += `    this.set('${field.name}', ${isList ? `JSON.stringify(value)` : 'value'});\n`;
      contents += `  }\n\n`;
    });

    contents = contents.slice(0, -1);
    contents += i === arr.length - 1 ? '}\n' : '}\n\n';
  });

  return contents;
};
