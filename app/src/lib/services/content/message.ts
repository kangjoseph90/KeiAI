import { encrypt, decrypt } from '$lib/crypto';
import { getActiveSession } from '../session';
import { localDB, type MessageRecord } from '$lib/adapters/db';
import { generateKeyBetween } from 'fractional-indexing';
import { deepMerge, type DeepPartial } from '$lib/utils/defaults';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import type { ToolCallAbstract } from './tool';
import { encryptedWriteQueue } from './write_queue';

// ─── Domain Types ──────────────────────────────────────────────────────

export interface MessageFields {
	role: 'user' | 'char' | 'system';
	content: string;
	thought?: string;
	toolCalls?: ToolCallAbstract[];
}

export interface Message extends MessageFields {
	id: string;
	chatId: string;
	sortOrder: string;
}

// ─── Defaults ─────────────────────────────────────────────────────────

const defaultMessageFields: MessageFields = {
	role: 'user',
	content: ''
};

// ─── Helpers ──────────────────────────────────────────────────────────

function decryptFields(masterKey: CryptoKey, record: MessageRecord): Promise<MessageFields> {
	return decrypt(masterKey, {
		ciphertext: record.encryptedData,
		iv: record.encryptedDataIV
	})
		.then((dec) => deepMerge(defaultMessageFields, JSON.parse(dec)))
		.catch((error) => {
			throw new AppError('ENCRYPTION_FAILED', 'Failed to decrypt message', error);
		});
}

// ─── Service ──────────────────────────────────────────────────────────

export class MessageService {
	/**
	 * Cursor-based pagination for UI (loads older messages)
	 * Returns messages sorted ascending (oldest first) within the batch
	 */
	static async getMessagesBefore(
		chatId: string,
		cursorSortOrder: string = '\uffff',
		limit = 50,
		offset = 0
	): Promise<Message[]> {
		await encryptedWriteQueue.flushTable('messages');
		const { masterKey } = getActiveSession();
		const records = await localDB.getRecordsBackward<MessageRecord>(
			'messages',
			'[chatId+sortOrder]',
			[chatId, ''],
			[chatId, cursorSortOrder],
			limit,
			offset
		);

		// The results are in reverse order (newest to oldest), so we need to reverse
		// them again to get an oldest-to-newest ordering for the UI to prepend.
		records.reverse();

		return Promise.all(
			records.map(async (record) => {
				const fields = await decryptFields(masterKey, record);
				return {
					id: record.id,
					chatId: record.chatId,
					sortOrder: record.sortOrder,
					...fields
				};
			})
		);
	}

	static async getMessagesAfter(
		chatId: string,
		cursorSortOrder: string = '',
		limit = 50,
		offset = 0
	): Promise<Message[]> {
		await encryptedWriteQueue.flushTable('messages');
		const { masterKey } = getActiveSession();

		const records = await localDB.getRecordsForward<MessageRecord>(
			'messages',
			'[chatId+sortOrder]',
			[chatId, cursorSortOrder],
			[chatId, '\uffff'],
			limit,
			offset
		);

		return Promise.all(
			records.map(async (record) => {
				const fields = await decryptFields(masterKey, record);
				return {
					id: record.id,
					chatId: record.chatId,
					sortOrder: record.sortOrder,
					...fields
				};
			})
		);
	}

	static async get(id: string): Promise<Message | null> {
		const { masterKey } = getActiveSession();
		const queued = encryptedWriteQueue.peek<MessageFields>('messages', id);
		if (queued) {
			const record = await localDB.getRecord<MessageRecord>('messages', id);
			if (!record || record.isDeleted) return null;
			return {
				id,
				chatId: record.chatId,
				sortOrder: record.sortOrder,
				...deepMerge(defaultMessageFields, queued as unknown as Record<string, unknown>)
			};
		}

		const record = await localDB.getRecord<MessageRecord>('messages', id);
		if (!record || record.isDeleted) return null;

		const fields = await decryptFields(masterKey, record);
		return {
			id: record.id,
			chatId: record.chatId,
			sortOrder: record.sortOrder,
			...fields
		};
	}

	/** Create a message */
	static async create(
		chatId: string,
		fields: DeepPartial<MessageFields> = {},
		providedSortOrder?: string
	): Promise<Message> {
		const resolved: MessageFields = deepMerge(
			defaultMessageFields,
			fields as Record<string, unknown>
		);

		const { masterKey, userId } = getActiveSession();
		const id = generateId();
		const now = Date.now();

		let sortOrder = providedSortOrder;
		if (!sortOrder) {
			const lastRecords = await localDB.getRecordsBackward<MessageRecord>(
				'messages',
				'[chatId+sortOrder]',
				[chatId, ''],
				[chatId, '\uffff'],
				1
			);
			if (lastRecords.length > 0) {
				sortOrder = generateKeyBetween(lastRecords[0].sortOrder, null);
			} else {
				sortOrder = generateKeyBetween(null, null);
			}
		}

		try {
			const enc = await encrypt(masterKey, JSON.stringify(resolved));
			const newRecord: MessageRecord = {
				id,
				userId,
				chatId,
				sortOrder,
				createdAt: now,
				updatedAt: now,
				isDeleted: false,
				encryptedData: enc.ciphertext,
				encryptedDataIV: enc.iv
			};
			await localDB.putRecord<MessageRecord>('messages', newRecord);
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to create message', error);
		}

		return { id, chatId, sortOrder, ...resolved };
	}

	/** Update a message */
	static async update(id: string, changes: DeepPartial<MessageFields>): Promise<Message> {
		const { masterKey } = getActiveSession();
		const queued = encryptedWriteQueue.peek<MessageFields>('messages', id);
		const record = await localDB.getRecord<MessageRecord>('messages', id);
		if (!record || record.isDeleted) {
			throw new AppError('NOT_FOUND', `Message not found: ${id}`);
		}

		try {
			const current = queued
				? deepMerge(defaultMessageFields, queued as unknown as Record<string, unknown>)
				: await decryptFields(masterKey, record);
			const updated: MessageFields = deepMerge(current, changes as Record<string, unknown>);

			encryptedWriteQueue.upsert<MessageFields, MessageRecord>({
				tableName: 'messages',
				id,
				userId: record.userId,
				createdAt: record.createdAt,
				nextFields: updated,
				mergeFields: (queuedCurrent, next) =>
					deepMerge(queuedCurrent, next as unknown as Record<string, unknown>),
				toRecord: ({
					id: recordId,
					userId: recordUserId,
					createdAt,
					updatedAt,
					encryptedData,
					encryptedDataIV
				}) => ({
					id: recordId,
					userId: recordUserId,
					chatId: record.chatId,
					sortOrder: record.sortOrder,
					createdAt,
					updatedAt,
					isDeleted: false,
					encryptedData,
					encryptedDataIV
				})
			});

			return { id, chatId: record.chatId, sortOrder: record.sortOrder, ...updated };
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to update message', error);
		}
	}

	/** Soft-delete a message */
	static async delete(id: string): Promise<void> {
		try {
			encryptedWriteQueue.drop('messages', id);
			await localDB.softDeleteRecord('messages', id);
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to delete message', error);
		}
	}
}
