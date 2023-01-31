import pluralize from 'pluralize';

export const getTableName = (name: string) => {
  if (name === '_metadata') return '_metadatas';

  return pluralize(name);
};
