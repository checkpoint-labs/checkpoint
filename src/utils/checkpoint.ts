import { CheckpointConfig } from '../types';

export const getContractsFromConfig = (config: CheckpointConfig): string[] => {
  return (config.sources || []).map(source => source.contract);
};
