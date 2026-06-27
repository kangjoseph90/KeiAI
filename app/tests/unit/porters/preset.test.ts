import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    exportPresetPackage,
    importPresetPackage,
    type KeiPresetPackageV1
} from '$lib/porters/preset';
import { readRisuPresetJson } from '$lib/porters/preset/risu';
import { PresetService, ScriptService, type Preset, type Script } from '$lib/services';
import { createDefaultChatWorkflow, getFirstAgentNode } from '$lib/workflow/defaults';

vi.mock('$lib/services', () => ({
    PresetService: {
        get: vi.fn(),
        create: vi.fn(),
        update: vi.fn()
    },
    ScriptService: {
        listByOwner: vi.fn(),
        create: vi.fn()
    }
}));

describe('preset porters', () => {
    const preset: Preset = {
        id: 'preset-real',
        name: 'Test Preset',
        description: 'Preset description',
        models: {
            chat: { id: 'openai::gpt-5.4', provider: 'openai' },
            aux: { id: 'openai::gpt-5.4', provider: 'openai' }
        },
        parameters: {
            chat: { temperature: 0.7 }
        },
        chatWorkflow: createDefaultChatWorkflow({
            promptBlocks: {
                block_1: {
                    id: 'block_1',
                    name: 'System',
                    type: 'text',
                    role: 'system',
                    content: 'You are helpful.',
                    sortOrder: 'a',
                    enabled: true
                }
            }
        }),
        defaultVariables: {},
        globalVariables: {},
        customToggles: {},
        scripts: {
            refs: { script_real: { id: 'script_real', sortOrder: 'a' } },
            folders: {}
        }
    };

    const script: Script = {
        id: 'script_real',
        ownerId: 'preset-real',
        scopeType: 'user',
        scopeId: 'user-1',
        type: 'regex',
        name: 'Script',
        regex: 'a',
        replacement: 'b',
        phase: 'display',
        advanced: false,
        flag: 'g',
        order: 100,
        repeat: 1,
        enabled: true
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('exports a preset package with portable ids and deep-copied content', async () => {
        vi.mocked(PresetService.get).mockResolvedValue(preset);
        vi.mocked(ScriptService.listByOwner).mockResolvedValue([script]);

        const pkg = await exportPresetPackage('preset-real');

        expect(pkg.kind).toBe('keiai.preset');
        expect(pkg.preset.name).toBe('Test Preset');
        expect(pkg.preset.models?.chat?.provider).toBe('openai');
        const agent = getFirstAgentNode(pkg.preset.chatWorkflow);
        expect(agent?.promptBlocks.block_1?.type).toBe('text');
        expect((agent?.promptBlocks.block_1 as { content: string } | undefined)?.content).toBe(
            'You are helpful.'
        );
        expect(pkg.preset.scripts.refs.script_0?.id).toBe('script_0');
        expect(pkg.scripts[0]?.id).toBe('script_0');
    });

    it('imports a preset package and reconnects script refs', async () => {
        const pkg = makePackage();

        vi.mocked(PresetService.create).mockResolvedValue({
            ...preset,
            id: 'preset-new',
            scripts: { refs: {}, folders: {} }
        });
        vi.mocked(ScriptService.create).mockResolvedValue({ ...script, id: 'script-new' });
        vi.mocked(PresetService.update).mockResolvedValue({ ...preset, id: 'preset-new' });

        const presetId = await importPresetPackage(pkg);
        const update = vi.mocked(PresetService.update).mock.calls[0]?.[1];

        expect(presetId).toBe('preset-new');
        expect(PresetService.create).toHaveBeenCalledWith(
            expect.objectContaining({
                name: 'Imported Preset',
                models: expect.objectContaining({
                    chat: expect.objectContaining({ provider: 'openai' })
                }),
                chatWorkflow: expect.objectContaining({
                    nodes: expect.any(Object)
                })
            })
        );
        expect(ScriptService.create).toHaveBeenCalledWith(
            'preset-new',
            expect.objectContaining({ name: 'Script' })
        );
        expect(update?.scripts?.refs?.['script-new']?.id).toBe('script-new');
    });

    it('converts Risu description to description macro and skips memory blocks', () => {
        const pkg = readRisuPresetJson({
            name: 'Risu Preset',
            promptTemplate: [
                { type: 'description', innerFormat: 'Desc: {{slot}}', name: 'Description' },
                { type: 'memory', innerFormat: 'Memory: {{slot}}', name: 'Memory' }
            ]
        });

        const agent = getFirstAgentNode(pkg.preset.chatWorkflow);
        expect(agent).not.toBeNull();
        const blocks = Object.values(agent?.promptBlocks ?? {});

        expect(blocks).toHaveLength(1);
        expect(blocks[0]).toEqual(
            expect.objectContaining({
                name: 'Description',
                type: 'text',
                content: 'Desc: {{description}}'
            })
        );
    });

    it('converts Risu globalNote to characternote blocks', () => {
        const pkg = readRisuPresetJson({
            name: 'Risu Preset',
            promptTemplate: [
                { type: 'plain', type2: 'globalNote', text: 'Note: {{slot}}', name: 'Global Note' }
            ]
        });

        const agent = getFirstAgentNode(pkg.preset.chatWorkflow);
        expect(agent).not.toBeNull();
        const blocks = Object.values(agent?.promptBlocks ?? {});

        expect(blocks).toHaveLength(1);
        expect(blocks[0]).toEqual(
            expect.objectContaining({
                name: 'Global Note',
                type: 'text',
                content: 'Note: {{characternote}}'
            })
        );
    });
});

function makePackage(overrides: Partial<KeiPresetPackageV1> = {}): KeiPresetPackageV1 {
    return {
        version: 1,
        kind: 'keiai.preset',
        preset: {
            name: 'Imported Preset',
            description: 'Description',
            models: {
                chat: { id: 'openai::gpt-5.4', provider: 'openai' },
                aux: { id: 'openai::gpt-5.4', provider: 'openai' }
            },
            parameters: {},
            chatWorkflow: createDefaultChatWorkflow({
                promptBlocks: {
                    block_1: {
                        id: 'block_1',
                        name: 'System',
                        type: 'text',
                        role: 'system',
                        content: 'Hello',
                        sortOrder: 'a',
                        enabled: true
                    }
                },
                maxResponse: 8000,
                maxContext: 80000,
                lorebookRatio: 0.3,
                memoryRatio: 0.3,
                lorebookScanDepth: 10
            }),
            defaultVariables: {},
            globalVariables: {},
            customToggles: {},
            scripts: {
                refs: { script_0: { id: 'script_0', sortOrder: 'a' } },
                folders: {}
            }
        },
        scripts: [
            {
                id: 'script_0',
                type: 'regex',
                name: 'Script',
                regex: 'a',
                replacement: 'b',
                phase: 'display',
                advanced: false,
                flag: 'g',
                order: 100,
                repeat: 1,
                enabled: true
            }
        ],
        ...overrides
    };
}
