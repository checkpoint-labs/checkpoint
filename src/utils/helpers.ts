export function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function chunk<T>(array: T[], chunkSize: number) {
  const chunks = [] as T[][];
  let index = 0;

  while (index < array.length) {
    chunks.push(array.slice(index, chunkSize + index));
    index += chunkSize;
  }

  return chunks;
}
