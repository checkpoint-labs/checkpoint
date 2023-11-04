import { parseEvent } from '../../../../src/providers/starknet/utils';
import {
  spaceFactoryAbi,
  spaceAbi,
  factoryAbiCairo1,
  spaceDeployedEvent,
  voteCreatedEvent,
  spaceDeployedEventCairo1
} from './fixtures';

describe('utils', () => {
  describe('parseEvent', () => {
    it('should parse event', () => {
      const output = parseEvent(spaceFactoryAbi, spaceDeployedEvent);

      expect(output).toMatchSnapshot();
    });

    it('should parse nested event', () => {
      const output = parseEvent(spaceAbi, voteCreatedEvent);

      expect(output).toMatchSnapshot();
    });

    it('should parse cairo 1 event', () => {
      const output = parseEvent(factoryAbiCairo1, spaceDeployedEventCairo1);

      expect(output).toMatchSnapshot();
    });
  });
});
