import {
	localDB,
	type CharacterSummaryRecord,
	type ChatSummaryRecord,
	type ModuleRecord,
	type LorebookRecord,
	type ScriptRecord,
	type MessageRecord
} from '../db/index.js';

export async function assertCharacterExists(characterId: string): Promise<void> {
	const record = await localDB.getRecord<CharacterSummaryRecord>('characterSummaries', characterId);
	if (!record || record.isDeleted) {
		throw new Error(`Character not found: ${characterId}`);
	}
}

export async function assertChatExists(chatId: string): Promise<void> {
	const record = await localDB.getRecord<ChatSummaryRecord>('chatSummaries', chatId);
	if (!record || record.isDeleted) {
		throw new Error(`Chat not found: ${chatId}`);
	}
}

export async function assertModuleExists(moduleId: string): Promise<void> {
	const record = await localDB.getRecord<ModuleRecord>('modules', moduleId);
	if (!record || record.isDeleted) {
		throw new Error(`Module not found: ${moduleId}`);
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

	throw new Error(`Owner not found: ${ownerId}`);
}

export async function assertChatOwnedByCharacter(
	chatId: string,
	characterId: string
): Promise<void> {
	const record = await localDB.getRecord<ChatSummaryRecord>('chatSummaries', chatId);
	if (!record || record.isDeleted) {
		throw new Error(`Chat not found: ${chatId}`);
	}
	if (record.characterId !== characterId) {
		throw new Error(`Chat ${chatId} does not belong to character ${characterId}`);
	}
}

export async function assertLorebookOwnedBy(ownerId: string, lorebookId: string): Promise<void> {
	const record = await localDB.getRecord<LorebookRecord>('lorebooks', lorebookId);
	if (!record || record.isDeleted) {
		throw new Error(`Lorebook not found: ${lorebookId}`);
	}
	if (record.ownerId !== ownerId) {
		throw new Error(`Lorebook ${lorebookId} does not belong to owner ${ownerId}`);
	}
}

export async function assertScriptOwnedBy(ownerId: string, scriptId: string): Promise<void> {
	const record = await localDB.getRecord<ScriptRecord>('scripts', scriptId);
	if (!record || record.isDeleted) {
		throw new Error(`Script not found: ${scriptId}`);
	}
	if (record.ownerId !== ownerId) {
		throw new Error(`Script ${scriptId} does not belong to owner ${ownerId}`);
	}
}

export async function assertMessageInChat(chatId: string, messageId: string): Promise<void> {
	const record = await localDB.getRecord<MessageRecord>('messages', messageId);
	if (!record || record.isDeleted) {
		throw new Error(`Message not found: ${messageId}`);
	}
	if (record.chatId !== chatId) {
		throw new Error(`Message ${messageId} does not belong to chat ${chatId}`);
	}
}
