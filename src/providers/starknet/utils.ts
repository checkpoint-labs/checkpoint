type Callback<Item> = Item extends { name: infer Name; type: infer Type }
  ? Name extends PropertyKey
    ? Record<Name, Type>
    : never
  : never;

type Reducer<T extends Array<any>, Acc = Record<string, unknown>> = T extends []
  ? Acc
  : T extends [infer Head, ...infer Tail]
  ? Reducer<Tail, Acc & Callback<Head>>
  : never;

export const parseEvent = <Item extends { name: string; type: string }, Input extends Item[]>(
  format: readonly [...Input],
  input: string[]
): Reducer<Input> => {
  let length = 0;
  let current = 0;

  return format.reduce((output, field) => {
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
  }, {}) as Reducer<Input>;
};
