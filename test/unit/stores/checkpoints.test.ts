import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { CheckpointsStore, getCheckpointId } from '../../../src/stores/checkpoints';
import { Logger } from '../../../src/utils/logger';

describe('CheckpointsStore', () => {
  let store: CheckpointsStore;
  let mockPrisma: any;
  let logger: Logger & DeepMockProxy<Logger>;

  beforeEach(() => {
    mockPrisma = mockDeep();
    logger = mockDeep<Logger>({
      child: () => mockDeep()
    });
    store = new CheckpointsStore(mockPrisma, logger);
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

      expect(mockPrisma.checkpoint.createMany.mock.calls).toMatchSnapshot();

      // verify id is properly computed
      const { id } = mockPrisma.checkpoint.createMany.mock.calls[0][0].data[0];

      expect(id).toEqual(
        getCheckpointId(checkpoints[0].contractAddress, checkpoints[0].blockNumber)
      );
    });
  });
});
