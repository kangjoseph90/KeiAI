import { describe, it, expect, beforeEach, vi } from 'vitest';
import { initDefaultContents } from '$lib/stores/init';

// Mock store functions
vi.mock('$lib/stores/content/persona', () => ({
    createPersona: vi.fn()
}));

vi.mock('$lib/stores/content/preset', () => ({
    createPreset: vi.fn(),
    selectPreset: vi.fn()
}));

vi.mock('$lib/stores/content/settings', () => ({
    loadSettings: vi.fn(),
    updateSettings: vi.fn()
}));

vi.mock('$lib/stores/content/character', () => ({
    createCharacter: vi.fn()
}));

vi.mock('$lib/stores/content/room', () => ({
    createRoom: vi.fn(),
    addRoomCharacter: vi.fn()
}));

import { createPersona } from '$lib/stores/content/persona';
import { createPreset, selectPreset } from '$lib/stores/content/preset';
import { createCharacter } from '$lib/stores/content/character';
import { addRoomCharacter, createRoom } from '$lib/stores/content/room';
import { updateSettings } from '$lib/stores/content/settings';

describe('Init Store', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(createPersona).mockResolvedValue({ id: 'persona-1' } as never);
        vi.mocked(createPreset).mockResolvedValue({ id: 'preset-1' } as never);
        vi.mocked(createCharacter).mockResolvedValue({ id: 'char-1' } as never);
        vi.mocked(createRoom).mockResolvedValue({ id: 'room-1' } as never);
        vi.mocked(addRoomCharacter).mockResolvedValue(undefined);
        vi.mocked(selectPreset).mockResolvedValue(undefined);
        vi.mocked(updateSettings).mockResolvedValue(undefined);
    });

    describe('initDefaultContents', () => {
        it('should call createPersona', async () => {
            await initDefaultContents();

            expect(createPersona).toHaveBeenCalledWith();
            expect(createPersona).toHaveBeenCalledTimes(1);
        });

        it('should call createPreset', async () => {
            await initDefaultContents();

            expect(createPreset).toHaveBeenCalledWith({
                chatWorkflow: expect.objectContaining({
                    nodes: expect.objectContaining({
                        chat_agent: expect.objectContaining({ class: 'Agent' }),
                        output: expect.objectContaining({ class: 'Output' })
                    })
                })
            });
            expect(createPreset).toHaveBeenCalledTimes(1);
        });

        it('should call createCharacter', async () => {
            await initDefaultContents();

            expect(createCharacter).toHaveBeenCalledWith();
            expect(createCharacter).toHaveBeenCalledTimes(1);
        });

        it('should call createRoom', async () => {
            await initDefaultContents();

            expect(createRoom).toHaveBeenCalledWith();
            expect(createRoom).toHaveBeenCalledTimes(1);
        });

        it('should call all create functions in parallel', async () => {
            await initDefaultContents();

            expect(createPersona).toHaveBeenCalled();
            expect(createPreset).toHaveBeenCalled();
            expect(createCharacter).toHaveBeenCalled();
            expect(createRoom).toHaveBeenCalled();
        });

        it('should attach the created character and select the created preset', async () => {
            await initDefaultContents();

            expect(addRoomCharacter).toHaveBeenCalledWith('room-1', 'char-1');
            expect(selectPreset).toHaveBeenCalledWith('preset-1');
        });

        it('should initialize the default task workflows', async () => {
            await initDefaultContents();

            expect(updateSettings).toHaveBeenCalledWith(
                expect.objectContaining({
                    translation: {
                        workflow: expect.objectContaining({
                            nodes: expect.objectContaining({
                                translation_agent: expect.objectContaining({ class: 'Agent' }),
                                translation_output: expect.objectContaining({ class: 'Output' })
                            })
                        })
                    },
                    imageGeneration: {
                        workflow: expect.objectContaining({
                            nodes: expect.objectContaining({
                                image_generation: expect.objectContaining({
                                    class: 'ImageGeneration'
                                }),
                                image_generation_output: expect.objectContaining({
                                    class: 'Output'
                                })
                            })
                        })
                    },
                    tts: {
                        workflow: expect.objectContaining({
                            nodes: expect.objectContaining({
                                tts: expect.objectContaining({ class: 'TTS' }),
                                tts_output: expect.objectContaining({ class: 'Output' })
                            })
                        })
                    }
                })
            );
        });

        it('should propagate errors from persona creation', async () => {
            vi.mocked(createPersona).mockRejectedValue(new Error('Persona failed'));

            await expect(initDefaultContents()).rejects.toThrow('Persona failed');
        });

        it('should propagate errors from preset creation', async () => {
            vi.mocked(createPreset).mockRejectedValue(new Error('Preset failed'));

            await expect(initDefaultContents()).rejects.toThrow('Preset failed');
        });

        it('should propagate errors from character creation', async () => {
            vi.mocked(createCharacter).mockRejectedValue(new Error('Character failed'));

            await expect(initDefaultContents()).rejects.toThrow('Character failed');
        });
    });
});
