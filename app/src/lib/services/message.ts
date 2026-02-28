import { getActiveSession, encryptText, decryptText } from '../session.js';
import { localDB, type MessageRecord } from '../db/index.js';
import { generateKeyBetween } from 'fractional-indexing';

// ─── Domain Types ────────────────────────────────────────────────────

export interface MessageFields {
	role: 'user' | 'char' | 'system';
	content: string;
}

export interface Message extends MessageFields {
	id: string;
	chatId: string;
	sortOrder: string;
	createdAt: number;
	updatedAt: number;
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
				const fields: MessageFields = JSON.parse(
					await decryptText(masterKey, {
						ciphertext: record.encryptedData,
						iv: record.encryptedDataIV
					})
				);
				return {
					id: record.id,
					chatId: record.chatId,
					sortOrder: record.sortOrder,
					...fields,
					createdAt: record.createdAt,
					updatedAt: record.updatedAt
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
				const fields: MessageFields = JSON.parse(
					await decryptText(masterKey, {
						ciphertext: record.encryptedData,
						iv: record.encryptedDataIV
					})
				);
				return {
					id: record.id,
					chatId: record.chatId,
					sortOrder: record.sortOrder,
					...fields,
					createdAt: record.createdAt,
					updatedAt: record.updatedAt
				};
			})
		);
	}

	/**
	 * Yields messages backward from cursorTime
	 * Used by prompt builder for efficient token-budget limited generation
	 */
	static async *generateMessagesBackward(
		chatId: string,
		cursorSortOrder: string = '\uffff',
		batchSize = 20
	): AsyncGenerator<Message, void, unknown> {
		const { masterKey } = getActiveSession();
		let currentCursor = cursorSortOrder;

		while (true) {
			const records = await localDB.getRecordsBackward<MessageRecord>(
				'messages',
				'[chatId+sortOrder]',
				[chatId, ''], // lower bound
				[chatId, currentCursor], // upper bound (exclusive)
				batchSize
			);

			if (records.length === 0) break;

			for (const record of records) {
				const fields: MessageFields = JSON.parse(
					await decryptText(masterKey, {
						ciphertext: record.encryptedData,
						iv: record.encryptedDataIV
					})
				);

				yield {
					id: record.id,
					chatId: record.chatId,
					sortOrder: record.sortOrder,
					...fields,
					createdAt: record.createdAt,
					updatedAt: record.updatedAt
				};

				currentCursor = record.sortOrder;
			}
		}
	}

	static async *generateMessagesForward(
		chatId: string,
		cursorSortOrder: string = '',
		batchSize = 20
	): AsyncGenerator<Message, void, unknown> {
		const { masterKey } = getActiveSession();
		let currentCursor = cursorSortOrder;

		while (true) {
			const records = await localDB.getRecordsForward<MessageRecord>(
				'messages',
				'[chatId+sortOrder]',
				[chatId, currentCursor], // lower bound
				[chatId, '\uffff'], // upper bound
				batchSize
			);

			if (records.length === 0) break;

			for (const record of records) {
				const fields: MessageFields = JSON.parse(
					await decryptText(masterKey, {
						ciphertext: record.encryptedData,
						iv: record.encryptedDataIV
					})
				);

				yield {
					id: record.id,
					chatId: record.chatId,
					sortOrder: record.sortOrder,
					...fields,
					createdAt: record.createdAt,
					updatedAt: record.updatedAt
				};

				currentCursor = record.sortOrder;
			}
		}
	}

	static async get(id: string): Promise<Message | null> {
		const { masterKey } = getActiveSession();
		const record = await localDB.getRecord<MessageRecord>('messages', id);
		if (!record || record.isDeleted) return null;

		const fields: MessageFields = JSON.parse(
			await decryptText(masterKey, {
				ciphertext: record.encryptedData,
				iv: record.encryptedDataIV
			})
		);
		return {
			id: record.id,
			chatId: record.chatId,
			sortOrder: record.sortOrder,
			...fields,
			createdAt: record.createdAt,
			updatedAt: record.updatedAt
		};
	}

	/** Create a message */
	static async create(
		chatId: string,
		fields: MessageFields,
		providedSortOrder?: string
	): Promise<Message> {
		const { masterKey, userId } = getActiveSession();
		const id = crypto.randomUUID();
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
				sortOrder = String(now).padStart(16, '0');
			}
		}

		const enc = await encryptText(masterKey, JSON.stringify(fields));

		await localDB.putRecord<MessageRecord>('messages', {
			id,
			userId,
			chatId,
			sortOrder,
			createdAt: now,
			updatedAt: now,
			isDeleted: false,
			encryptedData: enc.ciphertext,
			encryptedDataIV: enc.iv
		});

		return {
			id,
			chatId,
			sortOrder,
			...fields,
			createdAt: now,
			updatedAt: now
		};
	}

	/** Update a message */
	static async update(id: string, changes: Partial<MessageFields>): Promise<Message | null> {
		const { masterKey } = getActiveSession();
		const record = await localDB.getRecord<MessageRecord>('messages', id);
		if (!record || record.isDeleted) return null;

		const current: MessageFields = JSON.parse(
			await decryptText(masterKey, { ciphertext: record.encryptedData, iv: record.encryptedDataIV })
		);
		const updated = { ...current, ...changes };
		const enc = await encryptText(masterKey, JSON.stringify(updated));

		record.encryptedData = enc.ciphertext;
		record.encryptedDataIV = enc.iv;
		record.updatedAt = Date.now();
		await localDB.putRecord('messages', record);

		return {
			id: record.id,
			chatId: record.chatId,
			sortOrder: record.sortOrder,
			...updated,
			createdAt: record.createdAt,
			updatedAt: record.updatedAt
		};
	}

	/** Soft-delete a message */
	static async delete(id: string): Promise<void> {
		await localDB.softDeleteRecord('messages', id);
	}
}
