import { Provider, Log } from '@ethersproject/providers';
import { LogDescription } from '@ethersproject/abi';
import { BaseWriterParams } from '../../types';

export type Block = Awaited<ReturnType<Provider['getBlock']>>;

export type Writer = (
  args: {
    txId: string;
    block: Block | null;
    rawEvent?: Log;
    event?: LogDescription;
  } & BaseWriterParams
) => Promise<void>;
