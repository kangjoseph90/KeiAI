import { getActiveSession, encryptText, decryptText } from '../session.js';
import { localDB, type ChatRecord } from '../db/index.js';

export interface ChatSummary {
	title: string;
	lastMessagePreview: string;
}

export interface Chat {
	id: string;
	characterId: string;
	summary: ChatSummary;
	createdAt: number;
	updatedAt: number;
}

export class ChatService {
	static async create(characterId: string, title: string): Promise<Chat> {
		const { masterKey, userId } = getActiveSession();
		const id = crypto.randomUUID();
		const now = Date.now();

		const summary: ChatSummary = { title, lastMessagePreview: '' };
		const sumEnc = await encryptText(masterKey, JSON.stringify(summary));

		const record: ChatRecord = {
			id,
			userId,
			characterId,
			createdAt: now,
			updatedAt: now,
			isDeleted: false,
			encryptedSummary: sumEnc.ciphertext,
			summaryIv: sumEnc.iv
		};

		await localDB.putRecord('chats', record);

		return { id, characterId, summary, createdAt: now, updatedAt: now };
	}

	static async getByCharacterId(characterId: string): Promise<Chat[]> {
		const { masterKey } = getActiveSession();
		// We use index search on 'characterId' implemented in DexieAdapter
		const records = await localDB.getByIndex<ChatRecord>('chats', 'characterId', characterId, 100, 0);
		
		const results: Chat[] = [];
		for (const record of records) {
			const sumDec = await decryptText(masterKey, {
				ciphertext: record.encryptedSummary,
				iv: record.summaryIv
			});
			results.push({
				id: record.id,
				characterId: record.characterId,
				summary: JSON.parse(sumDec),
				createdAt: record.createdAt,
				updatedAt: record.updatedAt
			});
		}
		// Sort by newest
		results.sort((a,b) => b.updatedAt - a.updatedAt);
		
		return results;
	}
	
	static async updatePreview(chatId: string, preview: string): Promise<void> {
		const { masterKey } = getActiveSession();
		const record = await localDB.getRecord<ChatRecord>('chats', chatId);
		if (!record) return;
		
		const sumDec = await decryptText(masterKey, {
			ciphertext: record.encryptedSummary,
			iv: record.summaryIv
		});
		const summary: ChatSummary = JSON.parse(sumDec);
		summary.lastMessagePreview = preview;
		
		const sumEnc = await encryptText(masterKey, JSON.stringify(summary));
		record.encryptedSummary = sumEnc.ciphertext;
		record.summaryIv = sumEnc.iv;
		record.updatedAt = Date.now();
		
		await localDB.putRecord('chats', record);
	}

	static async update(id: string, summary: Partial<ChatSummary>): Promise<Chat | null> {
		const { masterKey } = getActiveSession();
		const record = await localDB.getRecord<ChatRecord>('chats', id);
		if (!record || record.isDeleted) return null;

		const sumDec = await decryptText(masterKey, { ciphertext: record.encryptedSummary, iv: record.summaryIv });
		const currentSummary: ChatSummary = JSON.parse(sumDec);
		const newSummary = { ...currentSummary, ...summary };

		const sumEnc = await encryptText(masterKey, JSON.stringify(newSummary));
		record.encryptedSummary = sumEnc.ciphertext;
		record.summaryIv = sumEnc.iv;
		record.updatedAt = Date.now();

		await localDB.putRecord('chats', record);

		return {
			id: record.id,
			characterId: record.characterId,
			summary: newSummary,
			createdAt: record.createdAt,
			updatedAt: record.updatedAt
		};
	}

	static async delete(id: string): Promise<void> {
		await localDB.softDeleteRecord('chats', id);
	}
}
