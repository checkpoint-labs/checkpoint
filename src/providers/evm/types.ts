import { Log, Block } from 'viem';
import { BaseWriterParams } from '../../types';

export type Writer = (
  args: {
    txId: string;
    block: Block | null;
    rawEvent?: Log;
    event?: any;
  } & BaseWriterParams
) => Promise<void>;
