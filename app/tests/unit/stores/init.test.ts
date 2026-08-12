import { describe, it, expect, beforeEach, vi } from 'vitest';
import { initDefaultContents } from '$lib/stores/init';
import { deviceLocale } from '$lib/stores/state';

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
        deviceLocale.set('en');
        vi.mocked(createPersona).mockResolvedValue({ id: 'persona-1' } as never);
        vi.mocked(createPreset).mockResolvedValue({ id: 'preset-1' } as never);
        vi.mocked(createCharacter).mockResolvedValue({ id: 'char-1' } as never);
        vi.mocked(createRoom).mockResolvedValue({ id: 'room-1' } as never);
        vi.mocked(addRoomCharacter).mockResolvedValue(undefined);
        vi.mocked(selectPreset).mockResolvedValue(undefined);
        vi.mocked(updateSettings).mockResolvedValue(undefined);
    });

    describe('initDefaultContents', () => {
        it('creates and durably initializes the default content', async () => {
            deviceLocale.set('ko');
            await initDefaultContents();

            expect(createPersona).toHaveBeenCalledOnce();
            expect(createPreset).toHaveBeenCalledWith({
                chatWorkflow: expect.objectContaining({
                    nodes: expect.objectContaining({
                        chat_agent: expect.objectContaining({ class: 'Agent' })
                    })
                })
            });
            expect(createCharacter).toHaveBeenCalledOnce();
            expect(createRoom).toHaveBeenCalledOnce();
            expect(addRoomCharacter).toHaveBeenCalledWith('room-1', 'char-1');
            expect(selectPreset).toHaveBeenCalledWith('preset-1');
            expect(updateSettings).toHaveBeenCalledWith(
                expect.objectContaining({
                    ui: { locale: 'ko' },
                    translation: { workflow: expect.any(Object) },
                    imageGeneration: { workflow: expect.any(Object) },
                    tts: { workflow: expect.any(Object) }
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
