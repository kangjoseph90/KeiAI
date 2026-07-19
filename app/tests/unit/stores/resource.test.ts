import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    CharacterService,
    ChatService,
    ModuleService,
    PresetService,
    defaultCharJSFields,
    defaultLorebookFields,
    defaultScriptFields,
    type Character,
    type CharJS,
    type Chat,
    type Lorebook,
    type Module,
    type Preset,
    type Script
} from '$lib/services';
import { characters, modules, presets, roomChats } from '$lib/stores/state';
import { saveCharacterLorebook } from '$lib/stores/content/character';
import { saveChatLorebook } from '$lib/stores/content/chat';
import { saveModuleCharJS } from '$lib/stores/content/module';
import { savePresetScript } from '$lib/stores/content/preset';

const emptyList = () => ({ refs: {}, folders: {} });

const character: Character = {
    id: 'character-1',
    scopeType: 'user',
    scopeId: 'user-1',
    name: 'Character',
    description: '',
    characterNote: '',
    backgroundHTML: '',
    messageCSS: '',
    greetings: {},
    defaultVariables: {},
    allowLowLevel: false,
    modules: emptyList(),
    lorebooks: emptyList(),
    scripts: emptyList(),
    charjs: emptyList(),
    assets: emptyList()
};

const module: Module = {
    id: 'module-1',
    name: 'Module',
    description: '',
    backgroundHTML: '',
    messageCSS: '',
    defaultVariables: {},
    toggles: emptyList(),
    allowLowLevel: false,
    lorebooks: emptyList(),
    scripts: emptyList(),
    charjs: emptyList(),
    assets: emptyList()
};

const chat: Chat = {
    id: 'chat-1',
    roomId: 'room-1',
    scopeType: 'user',
    scopeId: 'user-1',
    title: 'Chat',
    chatNote: '',
    messageCount: 0,
    lorebooks: emptyList(),
    personas: emptyList(),
    inlays: emptyList()
};

const preset: Preset = {
    id: 'preset-1',
    name: 'Preset',
    description: '',
    models: {},
    parameters: {},
    chatWorkflow: { nodes: {} },
    defaultVariables: {},
    toggles: emptyList(),
    scripts: emptyList()
};

describe('parent-owned resources', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        characters.clear();
        modules.clear();
        roomChats.clear();
        presets.clear();
        characters.set(character.id, structuredClone(character));
        modules.set(module.id, structuredClone(module));
        roomChats.set(chat.id, structuredClone(chat));
        presets.set(preset.id, structuredClone(preset));
    });

    it('saves a lorebook inside its character record', async () => {
        vi.spyOn(CharacterService, 'update').mockResolvedValue(character);
        const item: Lorebook = {
            ...defaultLorebookFields,
            name: 'Lore',
            id: 'lorebook-1',
            sortOrder: 'a0'
        };
        await saveCharacterLorebook(character.id, item);
        expect(CharacterService.update).toHaveBeenCalledWith(character.id, {
            lorebooks: { refs: { [item.id]: item } }
        });
    });

    it('saves a lorebook inside its chat record', async () => {
        vi.spyOn(ChatService, 'update').mockResolvedValue(chat);
        const item: Lorebook = {
            ...defaultLorebookFields,
            content: 'Chat lore',
            id: 'lorebook-1',
            sortOrder: 'a0'
        };
        await saveChatLorebook(chat.id, item);
        expect(ChatService.update).toHaveBeenCalledWith(chat.id, {
            lorebooks: { refs: { [item.id]: item } }
        });
    });

    it('saves CharJS inside its module record', async () => {
        vi.spyOn(ModuleService, 'update').mockResolvedValue(module);
        const item: CharJS = {
            ...defaultCharJSFields,
            name: 'Runtime',
            code: 'return 1',
            id: 'charjs-1',
            sortOrder: 'a0'
        };
        await saveModuleCharJS(module.id, item);
        expect(ModuleService.update).toHaveBeenCalledWith(module.id, {
            charjs: { refs: { [item.id]: item } }
        });
    });

    it('saves a regex script inside its preset record', async () => {
        vi.spyOn(PresetService, 'update').mockResolvedValue(preset);
        const item: Script = {
            ...defaultScriptFields,
            name: 'Regex',
            regex: 'a',
            id: 'script-1',
            sortOrder: 'a0'
        };
        await savePresetScript(preset.id, item);
        expect(PresetService.update).toHaveBeenCalledWith(preset.id, {
            scripts: { refs: { [item.id]: item } }
        });
    });
});
