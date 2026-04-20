import { encrypt, decrypt } from '$lib/crypto';
import { getActiveSession } from '../session';
import { localDB, type ToolCallRecord } from '$lib/adapters/db';
import { deepMerge, type DeepPartial } from '$lib/utils/defaults';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';
import { encryptedWriteQueue } from './write_queue';

export type ToolCallStatus = 'pending' | 'success' | 'rejected' | 'error';

// Abstract tool call info for message
export interface ToolCallAbstract {
	id: string; // internal tool callid
	name: string; // tool name
	status: ToolCallStatus;
}

export type ToolCallRequest = {
	callId: string; // Call Id given by LLM provider
	name: string;
	args: Record<string, unknown>;
};

export type ToolCallResponse =
	| { type: 'text'; text: string }
	| { type: 'image'; data: string; mimeType: string }
	| { type: 'audio'; data: string; mimeType: string }
	| { type: 'resource'; resource: { uri: string; mimeType: string; text: string } };

export interface ToolCallFields {
	status: ToolCallStatus;
	call: ToolCallRequest;
	response?: {
		content: ToolCallResponse[];
		isError?: boolean;
	};
}

export interface ToolCall extends ToolCallFields {
	id: string; // internal id
	chatId: string;
}

// ─── Defaults ─────────────────────────────────────────────────────────

const defaultToolCallFields: ToolCallFields = {
	status: 'pending',
	call: {
		callId: '',
		name: '',
		args: {}
	}
};

// ─── Helpers ──────────────────────────────────────────────────────────

function decryptFields(masterKey: CryptoKey, record: ToolCallRecord): Promise<ToolCallFields> {
	return decrypt(masterKey, {
		ciphertext: record.encryptedData,
		iv: record.encryptedDataIV
	})
		.then((dec) => deepMerge(defaultToolCallFields, JSON.parse(dec)))
		.catch((error) => {
			throw new AppError('ENCRYPTION_FAILED', 'Failed to decrypt tool call', error);
		});
}

// ─── Service ──────────────────────────────────────────────────────────

export class ToolCallService {
	/** List tool calls for a specific chat */
	static async listByChat(chatId: string): Promise<ToolCall[]> {
		await encryptedWriteQueue.flushTable('toolCalls');
		const { masterKey } = getActiveSession();
		const records = await localDB.getByIndex<ToolCallRecord>(
			'toolCalls',
			'chatId',
			chatId,
			Number.MAX_SAFE_INTEGER
		);

		return Promise.all(
			records.map(async (record) => {
				const fields = await decryptFields(masterKey, record);
				return {
					id: record.id,
					chatId: record.chatId,
					...fields
				};
			})
		);
	}

	static async get(id: string): Promise<ToolCall | null> {
		const { masterKey } = getActiveSession();
		const queued = encryptedWriteQueue.peek<ToolCallFields>('toolCalls', id);
		if (queued) {
			const record = await localDB.getRecord<ToolCallRecord>('toolCalls', id);
			if (!record || record.isDeleted) return null;
			return {
				id,
				chatId: record.chatId,
				...deepMerge(defaultToolCallFields, queued)
			};
		}

		const record = await localDB.getRecord<ToolCallRecord>('toolCalls', id);
		if (!record || record.isDeleted) return null;

		const fields = await decryptFields(masterKey, record);
		return {
			id: record.id,
			chatId: record.chatId,
			...fields
		};
	}

	static async create(chatId: string, fields: DeepPartial<ToolCallFields> = {}): Promise<ToolCall> {
		const resolved: ToolCallFields = deepMerge(defaultToolCallFields, fields);

		const { masterKey, userId } = getActiveSession();
		const id = generateId();
		const now = Date.now();

		try {
			const enc = await encrypt(masterKey, JSON.stringify(resolved));
			const newRecord: ToolCallRecord = {
				id,
				userId,
				chatId,
				createdAt: now,
				updatedAt: now,
				isDeleted: false,
				encryptedData: enc.ciphertext,
				encryptedDataIV: enc.iv
			};
			await localDB.putRecord<ToolCallRecord>('toolCalls', newRecord);
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to create tool call', error);
		}

		return { id, chatId, ...resolved };
	}

	static async update(id: string, changes: DeepPartial<ToolCallFields>): Promise<ToolCall> {
		const { masterKey } = getActiveSession();
		const queued = encryptedWriteQueue.peek<ToolCallFields>('toolCalls', id);
		const record = await localDB.getRecord<ToolCallRecord>('toolCalls', id);
		if (!record || record.isDeleted) {
			throw new AppError('NOT_FOUND', `Tool call not found: ${id}`);
		}

		try {
			const current = queued
				? deepMerge(defaultToolCallFields, queued)
				: await decryptFields(masterKey, record);
			const updated: ToolCallFields = deepMerge(current, changes);

			encryptedWriteQueue.upsert<ToolCallFields, ToolCallRecord>({
				tableName: 'toolCalls',
				id,
				userId: record.userId,
				createdAt: record.createdAt,
				nextFields: updated,
				mergeFields: (queuedCurrent, next) => deepMerge(queuedCurrent, next),
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
					createdAt,
					updatedAt,
					isDeleted: false,
					encryptedData,
					encryptedDataIV
				})
			});

			return { id, chatId: record.chatId, ...updated };
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to update tool call', error);
		}
	}

	static async delete(id: string): Promise<void> {
		try {
			encryptedWriteQueue.drop('toolCalls', id);
			await localDB.softDeleteRecord('toolCalls', id);
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError('DB_WRITE_FAILED', 'Failed to delete tool call', error);
		}
	}
}
