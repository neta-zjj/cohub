import type { BoardOperation } from "@neta-art/cohub";
import {
	type BoardPendingTransactionCacheRecord,
	idbDelete,
	idbGetAllByIndex,
	idbPut,
} from "$lib/cache/db";
import { boardPendingTransactionKey, getCacheUserKey } from "$lib/cache/keys";

export type BoardPendingTransaction = {
	spaceId: string;
	boardId: string;
	txId: string;
	baseVersion: number;
	ops: BoardOperation[];
};

export async function writeBoardPendingTransaction(
	input: BoardPendingTransaction,
) {
	const userKey = getCacheUserKey();
	const now = Date.now();
	const key = boardPendingTransactionKey(
		userKey,
		input.spaceId,
		input.boardId,
		input.txId,
	);
	const record: BoardPendingTransactionCacheRecord = {
		key,
		userKey,
		spaceId: input.spaceId,
		boardId: input.boardId,
		txId: input.txId,
		baseVersion: input.baseVersion,
		ops: input.ops,
		attemptCount: 0,
		createdAt: now,
		updatedAt: now,
		lastAttemptAt: null,
	};
	await idbPut("board_pending_txs", record);
	return record;
}

export async function deleteBoardPendingTransaction(input: {
	spaceId: string;
	boardId: string;
	txId: string;
}) {
	await idbDelete(
		"board_pending_txs",
		boardPendingTransactionKey(
			getCacheUserKey(),
			input.spaceId,
			input.boardId,
			input.txId,
		),
	);
}

export async function listBoardPendingTransactions(
	spaceId: string,
	boardId: string,
) {
	const rows = await idbGetAllByIndex<BoardPendingTransactionCacheRecord>(
		"board_pending_txs",
		"by_user_space_board",
		IDBKeyRange.only([getCacheUserKey(), spaceId, boardId]),
	);
	return rows.sort((a, b) => a.createdAt - b.createdAt);
}

export async function markBoardPendingTransactionAttempt(
	record: BoardPendingTransactionCacheRecord,
) {
	await idbPut("board_pending_txs", {
		...record,
		attemptCount: record.attemptCount + 1,
		lastAttemptAt: Date.now(),
		updatedAt: Date.now(),
	});
}
