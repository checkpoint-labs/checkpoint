import knex from 'knex';
import { mockDeep } from 'jest-mock-extended';
import { CheckpointsStore } from '../../../src/stores/checkpoints';
import { Logger } from '../../../src/utils/logger';

describe('CheckpointsStore', () => {
  const mockKnex = knex({
    client: 'sqlite3',
    connection: {
      filename: ':memory:'
    },
    useNullAsDefault: true
  });

  const logger = mockDeep<Logger>({
    child: () => mockDeep()
  });

  const store = new CheckpointsStore(mockKnex, logger);

  afterAll(async () => {
    await mockKnex.destroy();
  });

  describe('createStore', () => {
    it('should execute correct query', async () => {
      const { builder } = await store.createStore();

      expect(builder.toString()).toMatchSnapshot();
    });
  });

  describe('insertCheckpoints', () => {
    it('should insert checkpoints', async () => {
      const checkpoints = [
        {
          contractAddress: '0x0625dc1290b6e936be5f1a3e963cf629326b1f4dfd5a56738dea98e1ad31b7f3',
          blockNumber: 5000
        },
        {
          contractAddress: '0x0625dc1290b6e936be5f1a3e963cf629326b1f4dfd5a56738dea98e1ad31b7f3',
          blockNumber: 123222
        }
      ];

      await store.insertCheckpoints(checkpoints);

      const result = await mockKnex.select('*').from('_checkpoints');
      expect(result).toMatchSnapshot();
    });
  });
});
