type JsonFormat = { name: string; type: string }[];

const FORMAT_ALIASES = {
  uint256: 'Uint256'
};

export const convertFormat = (format: string): JsonFormat => {
  const parts = format.split(',').map(part => part.trim());

  return parts.map(part => {
    const matched = part.match(/\((.+)\)/);

    if (!matched) {
      return {
        name: part,
        type: 'felt'
      };
    }

    return {
      name: part.replace(matched[0], '').trim(),
      type: FORMAT_ALIASES[matched[1]] || matched[1]
    };
  });
};

export const parseEvent = (format: string | JsonFormat, input: string[]): Record<string, any> => {
  let length = 0;
  let current = 0;

  const jsonFormat = typeof format === 'string' ? convertFormat(format) : format;

  return jsonFormat.reduce((output, field) => {
    if (length > 0) {
      output[field.name] = input.slice(current, current + length);
      current += length;
      length = 0;

      return output;
    }

    if (field.type === 'Uint256') {
      const uint256 = input.slice(current, current + 2);

      output[field.name] = (BigInt(uint256[0]) + (BigInt(uint256[1]) << BigInt(128))).toString();
      current += 2;

      return output;
    }

    output[field.name] = input[current];
    if (field.name.endsWith('_len')) {
      length = parseInt(BigInt(input[current]).toString());
    }

    current++;

    return output;
  }, {});
};
