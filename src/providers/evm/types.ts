import { Provider, Log } from '@ethersproject/providers';
import { LogDescription } from '@ethersproject/abi';
import { BaseWriterParams } from '../../types';

type BlockWithTransactions = Awaited<ReturnType<Provider['getBlockWithTransactions']>>;
type Transaction = BlockWithTransactions['transactions'][number];

export type Writer = (
  args: {
    tx: Transaction;
    block: BlockWithTransactions | null;
    rawEvent?: Log;
    event?: LogDescription;
  } & BaseWriterParams
) => Promise<void>;
