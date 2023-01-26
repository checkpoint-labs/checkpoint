import { parseEvent } from '../../../../src/providers/starknet/utils';
import {
  spaceFactoryAbi,
  spaceAbi,
  spaceDeployedEventData,
  voteCreatedEventData
} from './fixtures';

describe('utils', () => {
  describe('parseEvent', () => {
    it('should parse event', () => {
      const output = parseEvent(spaceFactoryAbi, 'space_deployed', spaceDeployedEventData);

      expect(output).toMatchSnapshot();
    });

    it('should parse nested event', () => {
      const output = parseEvent(spaceAbi, 'vote_created', voteCreatedEventData);

      expect(output).toMatchSnapshot();
    });
  });
});
