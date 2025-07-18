import { Block, Log, DecodeEventLogReturnType } from 'viem';
import { BaseWriterParams } from '../../types';

export type Writer = (
  args: {
    txId: string;
    block: Block | null;
    rawEvent?: Log;
    event?: DecodeEventLogReturnType;
  } & BaseWriterParams
) => Promise<void>;
