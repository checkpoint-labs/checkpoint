import { GraphQLObjectType, buildSchema } from 'graphql';
import { getInitialValue, getBaseType, getJSType, codegen } from '../../src/codegen';
import { extendSchema } from '../../src/utils/graphql';

const SCHEMA_SOURCE = `
scalar Id
scalar Text
scalar BigInt
scalar BigDecimal

type Space {
  id: String!
  name: String
  about: String
  controller: String!
  voting_delay: Int!
  proposal_threshold: BigInt!
  quorum: Float!
  strategies: [String]!
  proposals: [Proposal]! @derivedFrom(field: "space")
}

type Proposal {
  id: String!
  proposal_id: Int!
  space: Space!
  title: Text!
  scores_total: BigInt!
  active: Boolean!
  progress: BigDecimal!
}
`;

const schema = buildSchema(extendSchema(SCHEMA_SOURCE));
const space = schema.getType('Space') as GraphQLObjectType;
const proposal = schema.getType('Proposal') as GraphQLObjectType;
const spaceFields = space.getFields();
const proposalFields = proposal.getFields();

describe('getInitialValue', () => {
  it('should return null for nullable types', () => {
    expect(getInitialValue(spaceFields['name'])).toBeNull();
    expect(getInitialValue(spaceFields['about'])).toBeNull();
  });

  it('should return 0 for Int/Float/BigInt types', () => {
    expect(getInitialValue(spaceFields['voting_delay'])).toBe(0);
    expect(getInitialValue(spaceFields['proposal_threshold'])).toBe(0);
    expect(getInitialValue(spaceFields['quorum'])).toBe(0);
  });

  it('should return 0 string for BigDecimal types', () => {
    expect(getInitialValue(proposalFields['progress'])).toBe('0');
  });

  it('should return empty string for String/Text/Id types', () => {
    expect(getInitialValue(spaceFields['id'])).toBe('');
    expect(getInitialValue(spaceFields['controller'])).toBe('');
    expect(getInitialValue(proposalFields['title'])).toBe('');
  });

  it('should return false for Boolean types', () => {
    expect(getInitialValue(proposalFields['active'])).toBe(false);
  });

  it('should return empty array for List types', () => {
    expect(getInitialValue(spaceFields['strategies'])).toEqual([]);
  });

  it('should return null for unknown types', () => {
    // TODO: replace with real unknown time once BigDecimals are handled
    expect(getInitialValue(proposalFields['space'])).toBeNull();
  });
});

describe('getBaseType', () => {
  it('should return number for Int/Float types', () => {
    expect(getBaseType(spaceFields['voting_delay'].type)).toBe('number');
    expect(getBaseType(proposalFields['proposal_id'].type)).toBe('number');
  });

  it('should return string for String/Text/Id types', () => {
    expect(getBaseType(spaceFields['id'].type)).toBe('string');
    expect(getBaseType(spaceFields['name'].type)).toBe('string');
    expect(getBaseType(proposalFields['title'].type)).toBe('string');
  });

  it('should return string for Object types', () => {
    expect(getBaseType(proposalFields['space'].type)).toBe('string');
  });

  it('should return bigint for BigInt types', () => {
    expect(getBaseType(spaceFields['proposal_threshold'].type)).toBe('bigint');
  });

  it('should return boolean for Boolean types', () => {
    expect(getBaseType(proposalFields['active'].type)).toBe('boolean');
  });

  it('should return string for BigDecimal types', () => {
    expect(getBaseType(proposalFields['progress'].type)).toBe('string');
  });

  it('should return array type for List types', () => {
    expect(getBaseType(spaceFields['strategies'].type)).toBe('string[]');
  });

  // TODO: handle unknown types
});

describe('getJSType', () => {
  it('should detect nullable types', () => {
    expect(getJSType(spaceFields['name'])).toEqual({
      isNullable: true,
      isList: false,
      baseType: 'string'
    });
  });

  it('should detect list types', () => {
    expect(getJSType(spaceFields['strategies'])).toEqual({
      isNullable: false,
      isList: true,
      baseType: 'string[]'
    });
  });
});

describe('codegen', () => {
  it('should generate code', () => {
    expect(codegen(SCHEMA_SOURCE)).toMatchSnapshot();
  });
});
