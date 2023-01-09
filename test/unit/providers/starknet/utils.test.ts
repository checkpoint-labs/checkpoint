import { convertFormat, parseEvent } from '../../../../src/providers/starknet/utils';
import {
  spaceDeployedEventFormat,
  spaceDeployedEventSimpleFormat,
  spaceDeployedEventData
} from './fixtures';

describe('utils', () => {
  describe('convertFormat', () => {
    it('should convert format', () => {
      const output = convertFormat(spaceDeployedEventSimpleFormat);

      expect(output).toEqual(spaceDeployedEventFormat);
    });
  });

  describe('parseEvent', () => {
    it('should parse event', () => {
      const output = parseEvent(spaceDeployedEventFormat, spaceDeployedEventData);

      expect(output).toMatchSnapshot();
    });

    it('should parse event using simple format', () => {
      const output = parseEvent(spaceDeployedEventSimpleFormat, spaceDeployedEventData);

      expect(output).toMatchSnapshot();
    });
  });
});
