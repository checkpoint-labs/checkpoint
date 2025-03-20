import { createGetCheckpointsRange } from '../../../../src/providers/core/createGetCheckpointsRange';

it('should call querySourceFn for every source', async () => {
  const sources = ['a', 'b', 'c'];

  const mockFunction = jest.fn().mockReturnValue([]);

  const getCheckpointsRange = createGetCheckpointsRange({
    sourcesFn: () => sources,
    keyFn: source => source,
    querySourceFn: mockFunction
  });

  await getCheckpointsRange(10, 20);
  expect(mockFunction).toHaveBeenCalledTimes(sources.length);
  for (const source of sources) {
    expect(mockFunction).toHaveBeenCalledWith(10, 20, source);
  }
});

it('should return value for requested source', async () => {
  let sources = ['a', 'b'];

  const mockFunction = jest.fn().mockImplementation((fromBlock, toBlock, source) => {
    return {
      blockNumber: 14,
      contractAddress: source
    };
  });

  const getCheckpointsRange = createGetCheckpointsRange({
    sourcesFn: () => sources,
    keyFn: source => source,
    querySourceFn: mockFunction
  });

  let result = await getCheckpointsRange(10, 20);
  expect(result).toEqual([
    {
      blockNumber: 14,
      contractAddress: 'a'
    },
    {
      blockNumber: 14,
      contractAddress: 'b'
    }
  ]);

  sources = ['b'];
  result = await getCheckpointsRange(10, 20);
  expect(result).toEqual([
    {
      blockNumber: 14,
      contractAddress: 'b'
    }
  ]);
});

describe('cache', () => {
  const mockFunction = jest.fn().mockResolvedValue([]);

  function getCheckpointQuery() {
    return createGetCheckpointsRange({
      sourcesFn: () => ['a'],
      keyFn: source => source,
      querySourceFn: mockFunction
    });
  }

  beforeEach(() => {
    mockFunction.mockClear();
  });

  // Case 1:
  // Cache exists and we are fetching the same range again
  // This triggers no queryFn calls
  it('exact cache match', async () => {
    const getCheckpointsRange = getCheckpointQuery();

    await getCheckpointsRange(10, 20);
    expect(mockFunction).toHaveBeenCalledTimes(1);

    mockFunction.mockClear();

    await getCheckpointsRange(10, 20);
    expect(mockFunction).toHaveBeenCalledTimes(0);
  });

  // Case 2:
  // Cache exists but we are fetching blocks outside of cache range
  // This triggers single queryFn call
  test('cache outside of the range', async () => {
    const getCheckpointsRange = getCheckpointQuery();

    await getCheckpointsRange(10, 20);
    expect(mockFunction).toHaveBeenCalledTimes(1);

    // Case 2a: Cache exists but we are fetching blocks further than the cache
    mockFunction.mockClear();

    await getCheckpointsRange(21, 31);
    expect(mockFunction).toHaveBeenCalledTimes(1);
    expect(mockFunction).toHaveBeenCalledWith(21, 31, 'a');

    // Case 2b: Cache exists but we are fetching blocks before the cache
    mockFunction.mockClear();

    await getCheckpointsRange(0, 9);
    expect(mockFunction).toHaveBeenCalledTimes(1);
    expect(mockFunction).toHaveBeenCalledWith(0, 9, 'a');
  });

  // Case 3:
  // Part of the range is cached and part of the range is not cached
  // This triggers two queryFn calls (one to fetch block before cache and one to fetch block after cache)
  test('cache is fully inside the range', async () => {
    const getCheckpointsRange = getCheckpointQuery();

    await getCheckpointsRange(10, 20);
    expect(mockFunction).toHaveBeenCalledTimes(1);

    mockFunction.mockClear();

    await getCheckpointsRange(5, 25);
    expect(mockFunction).toHaveBeenCalledTimes(2);
    expect(mockFunction).toHaveBeenCalledWith(5, 9, 'a');
    expect(mockFunction).toHaveBeenCalledWith(21, 25, 'a');
  });

  // Case 4:
  // Cache covers bottom part of the range
  // This triggers single queryFn call to fetch the top part of the range
  test('cache covers bottom part of range', async () => {
    const getCheckpointsRange = getCheckpointQuery();

    await getCheckpointsRange(10, 20);
    expect(mockFunction).toHaveBeenCalledTimes(1);

    mockFunction.mockClear();

    await getCheckpointsRange(15, 25);
    expect(mockFunction).toHaveBeenCalledTimes(1);
    expect(mockFunction).toHaveBeenCalledWith(21, 25, 'a');
  });

  // Case 5:
  // Cache covers top part of the range
  // This triggers single queryFn call to fetch the bottom part of the range
  test('cache covers top part of range', async () => {
    const getCheckpointsRange = getCheckpointQuery();

    await getCheckpointsRange(10, 20);
    expect(mockFunction).toHaveBeenCalledTimes(1);

    mockFunction.mockClear();

    await getCheckpointsRange(0, 15);
    expect(mockFunction).toHaveBeenCalledTimes(1);
    expect(mockFunction).toHaveBeenCalledWith(0, 9, 'a');
  });
});
