import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { AsyncMySqlPool } from '../../../src';
import { CheckpointsStore, getCheckpointId } from '../../../src/stores/checkpoints';
import { Logger } from '../../../src/utils/logger';

describe('CheckpointsStore', () => {
  let store: CheckpointsStore;
  let mockMysql: AsyncMySqlPool & DeepMockProxy<AsyncMySqlPool>;
  let logger: Logger & DeepMockProxy<Logger>;

  beforeEach(() => {
    mockMysql = mockDeep<AsyncMySqlPool>();
    logger = mockDeep<Logger>({
      child: () => mockDeep()
    });
    store = new CheckpointsStore(mockMysql, logger);
  });

  describe('createStore', () => {
    it('should execute correct query', async () => {
      await store.createStore();

      expect(mockMysql.queryAsync.mock.calls).toMatchSnapshot();
    });
  });

  describe('insertCheckpoints', () => {
    it('should should execute correct query', async () => {
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

      expect(mockMysql.queryAsync.mock.calls).toMatchSnapshot();

      // verify id is properly computed
      const queryParams = mockMysql.queryAsync.mock.calls[0][1];
      const firstBlockInput = queryParams[0][0];

      expect(firstBlockInput[0]).toEqual(
        getCheckpointId(checkpoints[0].contractAddress, checkpoints[0].blockNumber)
      );
    });
  });
});
