import {
	localDB,
	type CharacterSummaryRecord,
	type ChatSummaryRecord,
	type ModuleRecord,
	type LorebookRecord,
	type ScriptRecord,
	type MessageRecord
} from '../db/index.js';
import { AppError } from '../errors.js';

export async function assertCharacterExists(characterId: string): Promise<void> {
	const record = await localDB.getRecord<CharacterSummaryRecord>('characterSummaries', characterId);
	if (!record || record.isDeleted) {
		throw new AppError('NOT_FOUND', `Character not found: ${characterId}`);
	}
}

export async function assertChatExists(chatId: string): Promise<void> {
	const record = await localDB.getRecord<ChatSummaryRecord>('chatSummaries', chatId);
	if (!record || record.isDeleted) {
		throw new AppError('NOT_FOUND', `Chat not found: ${chatId}`);
	}
}

export async function assertModuleExists(moduleId: string): Promise<void> {
	const record = await localDB.getRecord<ModuleRecord>('modules', moduleId);
	if (!record || record.isDeleted) {
		throw new AppError('NOT_FOUND', `Module not found: ${moduleId}`);
	}
}

export async function assertOwnedResourceParentExists(ownerId: string): Promise<void> {
	const [character, chat, moduleItem] = await Promise.all([
		localDB.getRecord<CharacterSummaryRecord>('characterSummaries', ownerId),
		localDB.getRecord<ChatSummaryRecord>('chatSummaries', ownerId),
		localDB.getRecord<ModuleRecord>('modules', ownerId)
	]);

	if (
		(character && !character.isDeleted) ||
		(chat && !chat.isDeleted) ||
		(moduleItem && !moduleItem.isDeleted)
	) {
		return;
	}

	throw new AppError('NOT_FOUND', `Owner not found: ${ownerId}`);
}

export async function assertChatOwnedByCharacter(
	chatId: string,
	characterId: string
): Promise<void> {
	const record = await localDB.getRecord<ChatSummaryRecord>('chatSummaries', chatId);
	if (!record || record.isDeleted) {
		throw new AppError('NOT_FOUND', `Chat not found: ${chatId}`);
	}
	if (record.characterId !== characterId) {
		throw new AppError('OWNERSHIP_VIOLATION', `Chat ${chatId} does not belong to character ${characterId}`);
	}
}

export async function assertLorebookOwnedBy(ownerId: string, lorebookId: string): Promise<void> {
	const record = await localDB.getRecord<LorebookRecord>('lorebooks', lorebookId);
	if (!record || record.isDeleted) {
		throw new AppError('NOT_FOUND', `Lorebook not found: ${lorebookId}`);
	}
	if (record.ownerId !== ownerId) {
		throw new AppError('OWNERSHIP_VIOLATION', `Lorebook ${lorebookId} does not belong to owner ${ownerId}`);
	}
}

export async function assertScriptOwnedBy(ownerId: string, scriptId: string): Promise<void> {
	const record = await localDB.getRecord<ScriptRecord>('scripts', scriptId);
	if (!record || record.isDeleted) {
		throw new AppError('NOT_FOUND', `Script not found: ${scriptId}`);
	}
	if (record.ownerId !== ownerId) {
		throw new AppError('OWNERSHIP_VIOLATION', `Script ${scriptId} does not belong to owner ${ownerId}`);
	}
}

export async function assertMessageInChat(chatId: string, messageId: string): Promise<void> {
	const record = await localDB.getRecord<MessageRecord>('messages', messageId);
	if (!record || record.isDeleted) {
		throw new AppError('NOT_FOUND', `Message not found: ${messageId}`);
	}
	if (record.chatId !== chatId) {
		throw new AppError('OWNERSHIP_VIOLATION', `Message ${messageId} does not belong to chat ${chatId}`);
	}
}
