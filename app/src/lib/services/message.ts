import { getActiveSession, encryptText, decryptText } from '../session.js';
import { localDB, type MessageRecord } from '../db/index.js';

// ─── Domain Types ────────────────────────────────────────────────────

export interface MessageFields {
	role: 'user' | 'char' | 'system';
	content: string;
}

export interface Message extends MessageFields {
	id: string;
	chatId: string;
	createdAt: number;
	updatedAt: number;
}

// ─── Service ─────────────────────────────────────────────────────────

export class MessageService {
	/** List messages for a chat (oldest first) */
	static async listByChat(
		chatId: string,
		limit = 200,
		offset = 0
	): Promise<Message[]> {
		const { masterKey } = getActiveSession();
		const records = await localDB.getByIndex<MessageRecord>(
			'messages', 'chatId', chatId, limit, offset
		);

		records.sort((a, b) => a.createdAt - b.createdAt);

		const results: Message[] = [];
		for (const record of records) {
			const fields: MessageFields = JSON.parse(
				await decryptText(masterKey, { ciphertext: record.encryptedData, iv: record.encryptedDataIV })
			);
			results.push({
				id: record.id,
				chatId: record.chatId,
				...fields,
				createdAt: record.createdAt,
				updatedAt: record.updatedAt
			});
		}
		return results;
	}

	/** Create a message */
	static async create(
		chatId: string,
		fields: MessageFields
	): Promise<Message> {
		const { masterKey, userId } = getActiveSession();
		const id = crypto.randomUUID();
		const now = Date.now();

		const enc = await encryptText(masterKey, JSON.stringify(fields));

		await localDB.putRecord<MessageRecord>('messages', {
			id, userId, chatId, createdAt: now, updatedAt: now, isDeleted: false,
			encryptedData: enc.ciphertext, encryptedDataIV: enc.iv
		});

		return { id, chatId, ...fields, createdAt: now, updatedAt: now };
	}

	/** Update a message */
	static async update(
		id: string,
		changes: Partial<MessageFields>
	): Promise<Message | null> {
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
