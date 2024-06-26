import knex from 'knex';
import { getTableName, applyBlockFilter } from '../../../src/utils/database';

const mockKnex = knex({
  client: 'sqlite3',
  connection: {
    filename: ':memory:'
  },
  useNullAsDefault: true
});

afterAll(async () => {
  await mockKnex.destroy();
});

describe('getTableName', () => {
  it.each([
    ['table', 'tables'],
    ['user', 'users'],
    ['post', 'posts'],
    ['space', 'spaces'],
    ['vote', 'votes'],
    ['comment', 'comments']
  ])('should return pluralized table name', (name, expected) => {
    expect(getTableName(name)).toEqual(expected);
  });

  it('should return hardcoded table name for metadata', () => {
    expect(getTableName('_metadata')).toEqual('_metadatas');
  });
});

describe('applyBlockFilter', () => {
  it('should not apply filter for internal tables', () => {
    const query = mockKnex.select('*').from('_metadatas');

    const result = applyBlockFilter(query, '_metadatas', 123);

    expect(result.toString()).toBe('select * from `_metadatas`');
  });

  it('should apply capped block filter if block is provided', () => {
    const query = mockKnex.select('*').from('posts');

    const result = applyBlockFilter(query, 'posts', 123);

    expect(result.toString()).toBe('select * from `posts` where posts.block_range @> int8(123)');
  });

  it('should apply upper_inf block filter if block is not provided', () => {
    const query = mockKnex.select('*').from('posts');

    const result = applyBlockFilter(query, 'posts');

    expect(result.toString()).toBe('select * from `posts` where upper_inf(posts.block_range)');
  });
});
