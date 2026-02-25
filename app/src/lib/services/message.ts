import { getActiveSession, encryptText, decryptText } from '../session.js';
import { localDB, type MessageRecord } from '../db/index.js';
import { ChatService } from './chat.js';

export interface MessageData {
	role: 'user' | 'char' | 'system';
	content: string;
}

export interface PlainMessage {
	id: string;
	chatId: string;
	data: MessageData;
	createdAt: number;
	updatedAt: number;
}

export class MessageService {
	static async create(chatId: string, data: MessageData): Promise<PlainMessage> {
		const { masterKey, userId } = getActiveSession();
		const id = crypto.randomUUID();
		const now = Date.now();

		const dataEnc = await encryptText(masterKey, JSON.stringify(data));

		const record: MessageRecord = {
			id,
			userId,
			chatId,
			createdAt: now,
			updatedAt: now,
			isDeleted: false,
			encryptedData: dataEnc.ciphertext,
			dataIv: dataEnc.iv
		};

		await localDB.putRecord('messages', record);
		
		// Update chat preview using plain text 
		// (This internally encrypts the preview inside ChatRecord summary!)
		await ChatService.updatePreview(chatId, data.content.substring(0, 50));

		return { id, chatId, data, createdAt: now, updatedAt: now };
	}

	static async getByChatId(chatId: string): Promise<PlainMessage[]> {
		const { masterKey } = getActiveSession();
		const records = await localDB.getByIndex<MessageRecord>('messages', 'chatId', chatId, 200, 0);
		
		// Sort by createdAt ascending (oldest first for chat view)
		records.sort((a, b) => a.createdAt - b.createdAt);
		
		const results: PlainMessage[] = [];
		for (const record of records) {
			const dataDec = await decryptText(masterKey, {
				ciphertext: record.encryptedData,
				iv: record.dataIv
			});
			results.push({
				id: record.id,
				chatId: record.chatId,
				data: JSON.parse(dataDec),
				createdAt: record.createdAt,
				updatedAt: record.updatedAt
			});
		}
		return results;
	}

	static async update(id: string, data: Partial<MessageData>): Promise<PlainMessage | null> {
		const { masterKey } = getActiveSession();
		const record = await localDB.getRecord<MessageRecord>('messages', id);
		if (!record || record.isDeleted) return null;

		const dataDec = await decryptText(masterKey, { ciphertext: record.encryptedData, iv: record.dataIv });
		const currentData: MessageData = JSON.parse(dataDec);
		const newData = { ...currentData, ...data };

		const dataEnc = await encryptText(masterKey, JSON.stringify(newData));
		record.encryptedData = dataEnc.ciphertext;
		record.dataIv = dataEnc.iv;
		record.updatedAt = Date.now();

		await localDB.putRecord('messages', record);

		if (data.content !== undefined) {
			await ChatService.updatePreview(record.chatId, data.content.substring(0, 50));
		}

		return {
			id: record.id,
			chatId: record.chatId,
			data: newData,
			createdAt: record.createdAt,
			updatedAt: record.updatedAt
		};
	}

	static async delete(id: string): Promise<void> {
		await localDB.softDeleteRecord('messages', id);
	}
}
