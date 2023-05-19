import { Abi } from 'starknet';
import { EventsMap } from '../../types';

type StructAbi = {
  name: string;
  size: number;
  members: { name: string; type: string }[];
};

export const parseStruct = (
  type: string,
  data: string[],
  { current, structs }: { current: number; structs: Record<string, StructAbi> }
) => {
  const struct = structs[type];
  let structCurrent = current;

  return struct.members.reduce((output, field) => {
    if (structs[field.type]) {
      output[field.name] = parseStruct(field.type, data, { current: structCurrent, structs });
      structCurrent += structs[field.type].size;

      return output;
    }

    output[field.name] = data[structCurrent];
    structCurrent++;

    return output;
  }, {});
};

export const parseEvent = (abi: Abi, name: string, data: string[]): Record<string, any> => {
  const event = abi.find(el => el.name === name && el.type === 'event');
  if (!event) throw new Error('Unsupported event');

  const structs = abi
    .filter(el => el.type === 'struct')
    .reduce((acc, structAbi) => {
      acc[structAbi.name] = structAbi;
      return acc;
    }, {});

  let length = 0;
  let current = 0;

  return event.data.reduce((output, field) => {
    if (length > 0) {
      output[field.name] = data.slice(current, current + length);
      current += length;
      length = 0;

      return output;
    }

    if (structs[field.type]) {
      output[field.name] = parseStruct(field.type, data, { current, structs });
      current += structs[field.type].size;

      return output;
    }

    output[field.name] = data[current];
    if (field.name.endsWith('_len')) {
      length = parseInt(BigInt(data[current]).toString());
    }

    current++;

    return output;
  }, {});
};

/**
 * If block was fetched from one node and events from another, it's possible
 * that events will be empty, because node that handled events request
 * didn't know about the requested block yet. This function creates a validator
 * that will return false if there are no events in the block.
 * Once set number of retries is reached, validator will return true.
 * @param maxRetries - number of retries before giving up
 */
export function createResponseValidator({ maxRetries }: { maxRetries: number }) {
  let retryCounter = 0;

  return (blockEvents: EventsMap): boolean => {
    const hasEvents = Object.keys(blockEvents).length > 0;
    const reachedMaxRetries = retryCounter === maxRetries;

    if (hasEvents || reachedMaxRetries) {
      retryCounter = 0;
      return true;
    }

    retryCounter++;
    return false;
  };
}
