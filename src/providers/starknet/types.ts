import { RPC } from 'starknet';
import { BaseWriterParams } from '../../types';

// Shortcuts to starknet types.
export type Block = RPC.GetBlockWithTxs;
export type Transaction = RPC.GetBlockWithTxs['transactions'][number];
export type PendingTransaction = RPC.PendingTransactions[number];
export type Event = RPC.GetEventsResponse['events'][number];

// (Partially) narrowed types as real types are not exported from `starknet`.
export type FullBlock = Block & { block_number: number };
export type DeployTransaction = Transaction & { contract_address: string };

export type EventsMap = { [key: string]: Event[] };
export type ParsedEvent = Record<string, any>;

export type Writer = (
  args: {
    tx: Transaction;
    block: FullBlock | null;
    rawEvent?: Event;
    event?: ParsedEvent;
  } & BaseWriterParams
) => Promise<void>;

export function isFullBlock(block: Block): block is FullBlock {
  return 'block_number' in block;
}

export function isDeployTransaction(tx: Transaction | PendingTransaction): tx is DeployTransaction {
  return tx.type === 'DEPLOY';
}
