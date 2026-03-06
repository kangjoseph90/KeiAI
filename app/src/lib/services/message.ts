import { getActiveSession, encryptText, decryptText } from '../session.js';
import { localDB, type MessageRecord } from '../adapters/db/index.js';
import { SyncService } from '../core/api/sync.js';
import { generateKeyBetween } from 'fractional-indexing';
import { deepMerge } from '../shared/defaults.js';
import { assertChatExists, assertMessageInChat } from './guards.js';
import { AppError } from '../shared/errors.js';
import { generateId } from '../shared/id.js';

// ─── Domain Types ────────────────────────────────────────────────────

export interface MessageFields {
	role: 'user' | 'char' | 'system';
	content: string;
}

export interface Message extends MessageFields {
	id: string;
	chatId: string;
	sortOrder: string;
}

// ─── Defaults ────────────────────────────────────────────────────────

const defaultMessageFields: MessageFields = {
	role: 'user',
	content: ''
};

// ─── Helpers ─────────────────────────────────────────────────────────

function decryptFields(masterKey: CryptoKey, record: MessageRecord): Promise<MessageFields> {
	return decryptText(masterKey, {
		ciphertext: record.encryptedData,
		iv: record.encryptedDataIV
	})
		.then((dec) => deepMerge(defaultMessageFields, JSON.parse(dec)))
		.catch((error) => {
			throw new AppError('ENCRYPTION_FAILED', 'Failed to decrypt message', error);
		});
}

// ─── Service ─────────────────────────────────────────────────────────

export class MessageService {
	/**
	 * Cursor-based pagination for UI (loads older messages)
	 * Returns messages sorted ascending (oldest first) within the batch
	 */
	static async getMessagesBefore(
		chatId: string,
		cursorSortOrder: string = '\uffff',
		limit = 50
	): Promise<Message[]> {
		const { masterKey } = getActiveSession();
		const records = await localDB.getRecordsBackward<MessageRecord>(
			'messages',
			'[chatId+sortOrder]',
			[chatId, ''],
			[chatId, cursorSortOrder],
			limit
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
		limit = 50
	): Promise<Message[]> {
		const { masterKey } = getActiveSession();

		const records = await localDB.getRecordsForward<MessageRecord>(
			'messages',
			'[chatId+sortOrder]',
			[chatId, cursorSortOrder],
			[chatId, '\uffff'],
			limit
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
		fields: Partial<MessageFields> = {},
		providedSortOrder?: string
	): Promise<Message> {
		await assertChatExists(chatId);

		const resolved: MessageFields = deepMerge(defaultMessageFields, fields as Record<string, unknown>);

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
			const enc = await encryptText(masterKey, JSON.stringify(resolved));
			const newRecord: MessageRecord = {
				id, userId, chatId, sortOrder, createdAt: now, updatedAt: now, isDeleted: false,
				encryptedData: enc.ciphertext, encryptedDataIV: enc.iv
			};
			await localDB.putRecord<MessageRecord>('messages', newRecord);
			void SyncService.pushRecord('messages', newRecord, true);
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to create message', error);
		}

		return { id, chatId, sortOrder, ...resolved };
	}

	/** Update a message */
	static async update(
		id: string,
		changes: Partial<MessageFields>,
		expectedChatId?: string
	): Promise<Message> {
		const { masterKey } = getActiveSession();
		const record = await localDB.getRecord<MessageRecord>('messages', id);
		if (!record || record.isDeleted) {
			throw new AppError('NOT_FOUND', `Message not found: ${id}`);
		}
		if (expectedChatId) {
			await assertMessageInChat(expectedChatId, id);
		}

		try {
			const current = await decryptFields(masterKey, record);
			const updated: MessageFields = deepMerge(current, changes as Record<string, unknown>);
			const enc = await encryptText(masterKey, JSON.stringify(updated));

			record.encryptedData = enc.ciphertext;
			record.encryptedDataIV = enc.iv;
			record.updatedAt = Date.now();
			await localDB.putRecord('messages', record);
			void SyncService.pushRecord('messages', record);

			return { id, chatId: record.chatId, sortOrder: record.sortOrder, ...updated };
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to update message', error);
		}
	}

	/** Soft-delete a message */
	static async delete(id: string, expectedChatId?: string): Promise<void> {
		if (expectedChatId) {
			await assertMessageInChat(expectedChatId, id);
		}
		try {
			await localDB.softDeleteRecord('messages', id);
			void SyncService.pushById('messages', id);
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to delete message', error);
		}
	}
}
