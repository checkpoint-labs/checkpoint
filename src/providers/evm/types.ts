import type {
  PublicClient,
  Log as ViemLog,
  DecodeEventLogReturnType
} from 'viem';
import { BaseWriterParams } from '../../types';

export type Block = Awaited<ReturnType<PublicClient['getBlock']>>;
export type Log = ViemLog<number, number>;

export type Writer = (
  args: {
    txId: string;
    block: Block | null;
    rawEvent?: Log;
    event?: DecodeEventLogReturnType;
  } & BaseWriterParams
) => Promise<void>;
