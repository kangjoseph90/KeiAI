/**
 * Preset Service Tests
 *
 * Tests the PresetService which manages generation parameter presets.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PresetService, type PresetFields } from '$lib/services/content/preset';
import { localDB, type PresetRecord, type DataRecord } from '$lib/adapters/db';
import { encrypt, decrypt } from '$lib/crypto';
import { AppError } from '$lib/types/errors';
import { createDefaultChatWorkflow } from '$lib/workflow/defaults';

// Mock all dependencies
vi.mock('$lib/crypto', () => ({
    encrypt: vi.fn(),
    decrypt: vi.fn()
}));

vi.mock('$lib/services/session', () => ({
    getSessionScope: vi.fn((scopeType: 'user' | 'room') => {
        if (scopeType === 'user') return { scopeType: 'user', scopeId: 'user-123' };
        return { scopeType: 'room', scopeId: 'room-123' };
    }),
    canAccessScope: vi.fn((record: { scopeType: string; scopeId: string }) => {
        return (
            (record.scopeType === 'user' && record.scopeId === 'user-123') ||
            (record.scopeType === 'room' && record.scopeId === 'room-123')
        );
    }),
    canAccessUserScope: vi.fn((record: { scopeType: string; scopeId: string }) => {
        return record.scopeType === 'user' && record.scopeId === 'user-123';
    })
}));

vi.mock('$lib/adapters/db', () => ({
    localDB: {
        getAll: vi.fn(),
        getRecord: vi.fn(),
        putRecord: vi.fn(),
        softDeleteRecord: vi.fn(),
        softDeleteByIndex: vi.fn(),
        getByIndex: vi.fn().mockResolvedValue([]),
        transaction: vi.fn((_tables, _mode, cb) => cb())
    }
}));

vi.mock('$lib/utils/id', () => ({
    generateId: vi.fn(() => 'preset-123')
}));

vi.mock('$lib/services/content/record_buffer', () => ({
    buffer: {
        get: vi.fn(),
        update: vi.fn(),
        drop: vi.fn(),
        flushTable: vi.fn()
    }
}));

vi.mock('$lib/services/asset', () => ({
    AssetService: {
        deleteOwnerAssets: vi.fn()
    }
}));

import { buffer } from '$lib/services/content/record_buffer';
import { AssetService } from '$lib/services/asset';

describe('PresetService', () => {
    const mockUserId = 'user-123';
    const mockNow = 1710000000000;

    const mockFields: PresetFields = {
        name: 'Test Preset',
        description: 'Test Description',
        models: {
            chat: { id: 'openai::gpt-5.4', provider: 'openai' },
            aux: { id: '', provider: 'openai' }
        },
        parameters: {
            chat: { temperature: 0.9 }
        },
        chatWorkflow: createDefaultChatWorkflow({
            maxResponse: 600,
            maxContext: 4096,
            lorebookRatio: 0.2,
            lorebookScanDepth: 5,
            memoryRatio: 0.2
        }),
        defaultVariables: {},
        toggles: { refs: {}, folders: {} },
        scripts: { refs: {}, folders: {} }
    };

    const mockRecord: PresetRecord = {
        id: 'preset-123',
        scopeType: 'user',
        scopeId: mockUserId,
        createdAt: mockNow,
        updatedAt: mockNow,
        isDeleted: false,
        data: mockFields as unknown as Record<string, unknown>
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.setSystemTime(mockNow);
        vi.mocked(buffer.get).mockResolvedValue(null);
        vi.mocked(buffer.flushTable).mockResolvedValue(undefined);

        vi.mocked(encrypt).mockResolvedValue({
            ciphertext: new Uint8Array([0]),
            iv: new Uint8Array([0])
        });

        vi.mocked(decrypt).mockResolvedValue(JSON.stringify(mockFields));
    });

    describe('list', () => {
        it('should list all presets', async () => {
            vi.mocked(localDB.getAll).mockResolvedValue([mockRecord]);

            const result = await PresetService.list();

            expect(result).toHaveLength(1);
            expect(result[0].name).toBe(mockFields.name);
            expect(localDB.getAll).toHaveBeenCalledWith('presets', {
                scopeType: 'user',
                scopeId: mockUserId
            });
        });
    });

    describe('get', () => {
        it('should return full preset', async () => {
            vi.mocked(buffer.get).mockResolvedValue(mockRecord);

            const result = await PresetService.get('preset-123');

            expect(result).not.toBeNull();
            expect(result?.id).toBe('preset-123');
            expect(result?.name).toBe(mockFields.name);
            expect(result?.models?.chat?.id).toBe(mockFields.models?.chat?.id);
        });

        it('normalizes legacy workflow nodes and prompt blocks while parsing', async () => {
            vi.mocked(buffer.get).mockResolvedValue({
                ...mockRecord,
                data: {
                    ...mockFields,
                    chatWorkflow: {
                        nodes: {
                            agent: {
                                id: 'agent',
                                name: 'Legacy Agent',
                                class: 'Agent',
                                position: { x: 0, y: 0 },
                                llmType: 'chat',
                                promptBlocks: {
                                    history: {
                                        id: 'history',
                                        name: 'History',
                                        type: 'history',
                                        sortOrder: 'a',
                                        enabled: true
                                    }
                                },
                                inputs: { stream: null },
                                inputValues: { stream: true }
                            }
                        }
                    }
                } as unknown as Record<string, unknown>
            });

            const result = await PresetService.get('preset-123');
            const agent = result?.chatWorkflow.nodes.agent;
            expect(agent).toMatchObject({ toolIds: [], maxContext: 60000 });
            expect(agent?.class).toBe('Agent');
            if (!agent || agent.class !== 'Agent') throw new Error('Expected Agent node');
            expect(agent.promptBlocks.history).toMatchObject({
                historyMode: 'visible'
            });
        });

        it('should return null if record is missing', async () => {
            vi.mocked(buffer.get).mockResolvedValue(null);
            expect(await PresetService.get('none')).toBeNull();
        });
    });

    describe('create', () => {
        it('should create a preset record', async () => {
            const result = await PresetService.create(mockFields);

            expect(result.id).toBe('preset-123');
            expect(localDB.putRecord).toHaveBeenCalledTimes(1);
            expect(localDB.putRecord).toHaveBeenCalledWith(
                'presets',
                expect.objectContaining({
                    id: 'preset-123',
                    scopeType: 'user',
                    scopeId: mockUserId
                })
            );
        });

        it('uses an empty workflow only as a structural fallback', async () => {
            const result = await PresetService.create({ name: 'Minimal Preset' });

            expect(result.chatWorkflow).toEqual({ nodes: {} });
        });
    });

    describe('update', () => {
        it('should update preset correctly', async () => {
            vi.mocked(buffer.get).mockResolvedValue(mockRecord);
            const agent = mockFields.chatWorkflow.nodes.chat_agent;
            expect(agent?.class).toBe('Agent');
            if (agent?.class !== 'Agent') throw new Error('Expected chat Agent node');

            const result = await PresetService.update('preset-123', {
                name: 'New Name',
                chatWorkflow: {
                    nodes: {
                        [agent.id]: {
                            maxResponse: 800
                        }
                    }
                }
            });

            expect(result.name).toBe('New Name');
            const updatedAgent = result.chatWorkflow.nodes.chat_agent;
            expect(updatedAgent?.class).toBe('Agent');
            expect(updatedAgent?.class === 'Agent' ? updatedAgent.maxResponse : undefined).toBe(
                800
            );

            expect(buffer.update).toHaveBeenCalled();
        });

        it('should throw if record not found', async () => {
            vi.mocked(buffer.get).mockResolvedValue(null);
            await expect(PresetService.update('none', {})).rejects.toThrow(AppError);
        });
    });

    describe('delete', () => {
        it('should soft delete the record and its owned scripts', async () => {
            vi.mocked(buffer.get).mockResolvedValue(mockRecord);
            vi.mocked(localDB.getByIndex).mockResolvedValue([
                {
                    id: 'script-1',
                    scopeType: 'user',
                    scopeId: 'user-123',
                    createdAt: 1000,
                    updatedAt: 1000,
                    isDeleted: false,
                    data: {}
                }
            ] as unknown as DataRecord[]);
            await PresetService.delete('preset-123');
            expect(localDB.softDeleteRecord).toHaveBeenCalledWith('presets', 'preset-123');
            expect(localDB.softDeleteByIndex).not.toHaveBeenCalled();
            expect(AssetService.deleteOwnerAssets).not.toHaveBeenCalled();
        });
    });
});
