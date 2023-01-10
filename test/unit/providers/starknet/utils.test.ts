import { parseEvent } from '../../../../src/providers/starknet/utils';
import { spaceFactoryAbi, spaceDeployedEventData } from './fixtures';

describe('utils', () => {
  describe('parseEvent', () => {
    it('should parse event', () => {
      const output = parseEvent(spaceFactoryAbi, 'space_deployed', spaceDeployedEventData);

      expect(output).toMatchSnapshot();
    });
  });
});
