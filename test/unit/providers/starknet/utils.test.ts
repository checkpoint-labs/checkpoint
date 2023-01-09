import { parseEvent } from '../../../../src/providers/starknet/utils';
import { spaceDeployedEventFormat, spaceDeployedEventData } from './fixtures';

describe('utils', () => {
  describe('parseEvent', () => {
    it('should parse event', () => {
      const output = parseEvent(spaceDeployedEventFormat, spaceDeployedEventData);

      expect(output).toMatchSnapshot();
    });
  });
});
