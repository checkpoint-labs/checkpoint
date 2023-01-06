import { parseEvent } from '../../../src/utils/events';
import { spaceDeployedEventFormat, spaceDeployedEventData } from './fixtures';

describe('events', () => {
  describe('parseEvent', () => {
    it('should parse event', () => {
      const output = parseEvent(spaceDeployedEventFormat, spaceDeployedEventData);

      expect(output).toMatchSnapshot();
    });
  });
});
