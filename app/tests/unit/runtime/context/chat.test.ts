import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChatContext } from '$lib/runtime/context/chat';
import {
	getChatDetail,
	getCharacterDetail,
	getAppSettings,
	getPersona,
	getPresetDetail,
	getMergedLorebooks,
	getMergedScripts
} from '$lib/stores';
import type {
	ChatDetail,
	CharacterDetail,
	AppSettings,
	Persona,
	PresetDetail,
	Message
} from '$lib/services';
import { MessageService } from '$lib/services';

// Mock Store APIs
vi.mock('$lib/stores', () => ({
	getChatDetail: vi.fn(),
	getCharacterDetail: vi.fn(),
	getAppSettings: vi.fn(),
	getPersona: vi.fn(),
	getPresetDetail: vi.fn(),
	getMergedLorebooks: vi.fn(),
	getMergedScripts: vi.fn()
}));

vi.mock('$lib/services', async (importOriginal) => {
	const original = await importOriginal<typeof import('$lib/services')>();
	return {
		...original,
		MessageService: {
			getMessagesAfter: vi.fn(),
			getMessagesBefore: vi.fn()
		}
	};
});

describe('ChatContext', () => {
	const chatId = 'chat-1';
	const characterId = 'char-1';
	const personaId = 'pers-1';
	const globalPersonaId = 'global-pers-1';

	const mockChat = { id: chatId, characterId } as ChatDetail;
	const mockCharacter = { id: characterId, data: { personaId } } as CharacterDetail;
	const mockSettings = { personaId: globalPersonaId } as AppSettings;
	const mockPersona = { id: personaId, name: 'Character Persona' } as Persona;
	const mockGlobalPersona = { id: globalPersonaId, name: 'Global Persona' } as Persona;

	let context: ChatContext;

	beforeEach(() => {
		vi.clearAllMocks();
		context = new ChatContext(chatId);
	});

	it('should resolve chat detail and cache it', async () => {
		vi.mocked(getChatDetail).mockResolvedValue(mockChat);

		const chat1 = await context.getChat();
		const chat2 = await context.getChat();

		expect(chat1).toEqual(mockChat);
		expect(chat2).toEqual(mockChat);
		expect(getChatDetail).toHaveBeenCalledTimes(1);
		expect(getChatDetail).toHaveBeenCalledWith(chatId);
	});

	it('should resolve character detail through chat', async () => {
		vi.mocked(getChatDetail).mockResolvedValue(mockChat);
		vi.mocked(getCharacterDetail).mockResolvedValue(mockCharacter);

		const char = await context.getCharacter();

		expect(char).toEqual(mockCharacter);
		expect(getCharacterDetail).toHaveBeenCalledWith(characterId);
	});

	it('should resolve persona from character override', async () => {
		vi.mocked(getAppSettings).mockResolvedValue(mockSettings);
		vi.mocked(getChatDetail).mockResolvedValue(mockChat);
		vi.mocked(getCharacterDetail).mockResolvedValue(mockCharacter);
		vi.mocked(getPersona).mockResolvedValue(mockPersona);

		const persona = await context.getPersona();

		expect(persona).toEqual(mockPersona);
		expect(getPersona).toHaveBeenCalledWith(personaId);
	});

	it('should fall back to global persona if character has no personaId', async () => {
		const charNoPersona = {
			...mockCharacter,
			data: { ...mockCharacter.data, personaId: undefined }
		};
		vi.mocked(getAppSettings).mockResolvedValue(mockSettings);
		vi.mocked(getChatDetail).mockResolvedValue(mockChat);
		vi.mocked(getCharacterDetail).mockResolvedValue(charNoPersona as CharacterDetail);
		vi.mocked(getPersona).mockResolvedValue(mockGlobalPersona);

		const persona = await context.getPersona();

		expect(persona).toEqual(mockGlobalPersona);
		expect(getPersona).toHaveBeenCalledWith(globalPersonaId);
	});

	it('should return null if neither character nor settings have personaId', async () => {
		const charNoPersona = {
			...mockCharacter,
			data: { ...mockCharacter.data, personaId: undefined }
		};
		const settingsNoPersona = { ...mockSettings, personaId: undefined };
		vi.mocked(getAppSettings).mockResolvedValue(settingsNoPersona as AppSettings);
		vi.mocked(getChatDetail).mockResolvedValue(mockChat);
		vi.mocked(getCharacterDetail).mockResolvedValue(charNoPersona as CharacterDetail);

		const persona = await context.getPersona();

		expect(persona).toBeNull();
		expect(getPersona).not.toHaveBeenCalled();
	});

	it('should resolve merged lorebooks', async () => {
		vi.mocked(getMergedLorebooks).mockResolvedValue([]);
		await context.getLorebooks();
		expect(getMergedLorebooks).toHaveBeenCalledWith(chatId);
	});

	it('should resolve merged scripts', async () => {
		vi.mocked(getMergedScripts).mockResolvedValue([]);
		await context.getScripts();
		expect(getMergedScripts).toHaveBeenCalledWith(chatId);
	});

	it('should resolve preset from settings', async () => {
		const mockPreset = { id: 'preset-1' } as PresetDetail;
		vi.mocked(getAppSettings).mockResolvedValue({ ...mockSettings, presetId: 'preset-1' });
		vi.mocked(getPresetDetail).mockResolvedValue(mockPreset);

		const preset = await context.getPreset();

		expect(preset).toEqual(mockPreset);
		expect(getPresetDetail).toHaveBeenCalledWith('preset-1');
	});

	describe('getMessages', () => {
		const mockMessages = [{ id: 'm1' }, { id: 'm2' }] as Message[];

		beforeEach(() => {
			vi.mocked(getChatDetail).mockResolvedValue({ ...mockChat, messageCount: 100 } as ChatDetail);
			vi.mocked(MessageService.getMessagesAfter).mockResolvedValue(mockMessages);
		});

		it('should fetch range from start (0, 5)', async () => {
			const result = await context.getMessages(0, 5);

			expect(result).toEqual(mockMessages);
			expect(MessageService.getMessagesAfter).toHaveBeenCalledWith(chatId, '', 5, 0);
		});

		it('should handle end = undefined (fetch till end)', async () => {
			await context.getMessages(95);

			expect(MessageService.getMessagesAfter).toHaveBeenCalledWith(chatId, '', 5, 95);
		});

		it('should handle negative start index (-10)', async () => {
			await context.getMessages(-10);

			expect(MessageService.getMessagesAfter).toHaveBeenCalledWith(chatId, '', 10, 90);
		});

		it('should handle RisuAI-style negative range (0, -1)', async () => {
			await context.getMessages(0, -1);

			expect(MessageService.getMessagesAfter).toHaveBeenCalledWith(chatId, '', 99, 0);
		});

		it('should clamp indices and handle empty results', async () => {
			vi.mocked(getChatDetail).mockResolvedValue({ ...mockChat, messageCount: 0 } as ChatDetail);
			const result = await context.getMessages(0, 5);

			expect(result).toEqual([]);
			expect(MessageService.getMessagesAfter).not.toHaveBeenCalled();
		});

		it('should return empty array if realStart >= realEnd', async () => {
			const result = await context.getMessages(10, 5);

			expect(result).toEqual([]);
			expect(MessageService.getMessagesAfter).not.toHaveBeenCalled();
		});

		it('should clamp out-of-bounds start/end', async () => {
			await context.getMessages(-200, 200);

			expect(MessageService.getMessagesAfter).toHaveBeenCalledWith(chatId, '', 100, 0);
		});
	});
});
