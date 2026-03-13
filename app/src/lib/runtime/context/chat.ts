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
	Lorebook,
	Script,
	PresetDetail
} from '$lib/services';

export class ChatContext {
	public readonly chatId: string;

	private _chat?: ChatDetail;
	private _character?: CharacterDetail;
	private _settings?: AppSettings;
	private _persona?: Persona | null;
	private _lorebooks?: Lorebook[];
	private _scripts?: Script[];
	private _preset?: PresetDetail | null;

	constructor(chatId: string) {
		this.chatId = chatId;
	}

	public async getChat(): Promise<ChatDetail> {
		if (this._chat) return this._chat;
		this._chat = await getChatDetail(this.chatId);
		return this._chat;
	}

	public async getCharacter(): Promise<CharacterDetail> {
		if (this._character) return this._character;
		const chat = await this.getChat();
		this._character = await getCharacterDetail(chat.characterId);
		return this._character;
	}

	public async getSettings(): Promise<AppSettings> {
		if (this._settings) return this._settings;
		this._settings = await getAppSettings();
		return this._settings;
	}

	public async getPersona(): Promise<Persona | null> {
		if (this._persona !== undefined) return this._persona;
		const settings = await this.getSettings();
		const char = await this.getCharacter();
		if (char.data.personaId) {
			this._persona = await getPersona(char.data.personaId);
		} else if (settings.personaId) {
			this._persona = await getPersona(settings.personaId);
		} else {
			this._persona = null;
		}
		return this._persona;
	}

	public async getLorebooks(): Promise<Lorebook[]> {
		if (this._lorebooks) return this._lorebooks;
		this._lorebooks = await getMergedLorebooks(this.chatId);
		return this._lorebooks;
	}

	public async getScripts(): Promise<Script[]> {
		if (this._scripts) return this._scripts;
		this._scripts = await getMergedScripts(this.chatId);
		return this._scripts;
	}

	public async getPreset(): Promise<PresetDetail | null> {
		if (this._preset !== undefined) return this._preset;
		const settings = await this.getSettings();
		if (settings.presetId) {
			this._preset = await getPresetDetail(settings.presetId);
		} else {
			this._preset = null;
		}
		return this._preset;
	}
}
