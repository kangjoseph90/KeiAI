import { describe, it, expect, beforeEach, vi } from 'vitest';
import { initDefaultContents } from '$lib/stores/init';

// Mock store functions
vi.mock('$lib/stores/content/persona', () => ({
    createPersona: vi.fn(),
    selectPersona: vi.fn()
}));

vi.mock('$lib/stores/content/preset', () => ({
    createPreset: vi.fn(),
    selectPreset: vi.fn()
}));

vi.mock('$lib/stores/content/character', () => ({
    createCharacter: vi.fn()
}));

import { createPersona, selectPersona } from '$lib/stores/content/persona';
import { createPreset, selectPreset } from '$lib/stores/content/preset';
import { createCharacter } from '$lib/stores/content/character';

describe('Init Store', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(createPersona).mockResolvedValue({ id: 'persona-1' } as never);
        vi.mocked(createPreset).mockResolvedValue({ id: 'preset-1' } as never);
        vi.mocked(createCharacter).mockResolvedValue({ id: 'char-1' } as never);
        vi.mocked(selectPersona).mockResolvedValue(undefined);
        vi.mocked(selectPreset).mockResolvedValue(undefined);
    });

    describe('initDefaultContents', () => {
        it('should call createPersona', async () => {
            await initDefaultContents();

            expect(createPersona).toHaveBeenCalledWith();
            expect(createPersona).toHaveBeenCalledTimes(1);
        });

        it('should call createPreset', async () => {
            await initDefaultContents();

            expect(createPreset).toHaveBeenCalledWith();
            expect(createPreset).toHaveBeenCalledTimes(1);
        });

        it('should call createCharacter', async () => {
            await initDefaultContents();

            expect(createCharacter).toHaveBeenCalledWith();
            expect(createCharacter).toHaveBeenCalledTimes(1);
        });

        it('should call all create functions in parallel', async () => {
            await initDefaultContents();

            expect(createPersona).toHaveBeenCalled();
            expect(createPreset).toHaveBeenCalled();
            expect(createCharacter).toHaveBeenCalled();
        });

        it('should select the created persona and preset', async () => {
            await initDefaultContents();

            expect(selectPersona).toHaveBeenCalledWith('persona-1');
            expect(selectPreset).toHaveBeenCalledWith('preset-1');
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
