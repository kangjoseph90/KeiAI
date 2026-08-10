import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import type { IKeyValueAdapter } from '$lib/adapters/kv';
import { themePreference } from '$lib/stores/state';
import {
    applyTheme,
    loadThemePreference,
    resolveTheme,
    THEME_PREFERENCE_KEY,
    updateThemePreference
} from '$lib/stores/theme';

function createStorage(value: string | null): IKeyValueAdapter {
    return {
        get: vi.fn().mockResolvedValue(value),
        set: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
        keys: vi.fn().mockResolvedValue([]),
        init: vi.fn().mockResolvedValue(undefined)
    };
}

describe('theme preference', () => {
    beforeEach(() => {
        themePreference.set('system');
    });

    it('restores the device-local preference', async () => {
        const storage = createStorage('light');

        await loadThemePreference(storage);

        expect(storage.get).toHaveBeenCalledWith(THEME_PREFERENCE_KEY);
        expect(get(themePreference)).toBe('light');
    });

    it('falls back to system for a missing or invalid preference', async () => {
        await loadThemePreference(createStorage('sepia'));
        expect(get(themePreference)).toBe('system');
    });

    it('updates state after persistence succeeds', async () => {
        const storage = createStorage(null);

        await updateThemePreference('dark', storage);

        expect(storage.set).toHaveBeenCalledWith(THEME_PREFERENCE_KEY, 'dark');
        expect(get(themePreference)).toBe('dark');
    });

    it('keeps the current state when persistence fails', async () => {
        const storage = createStorage(null);
        vi.mocked(storage.set).mockRejectedValue(new Error('storage failed'));

        await expect(updateThemePreference('dark', storage)).rejects.toThrow('storage failed');
        expect(get(themePreference)).toBe('system');
    });

    it('resolves and applies explicit and system preferences', () => {
        expect(resolveTheme('light', true)).toBe('light');
        expect(resolveTheme('dark', false)).toBe('dark');
        expect(resolveTheme('system', true)).toBe('dark');

        const toggle = vi.fn();
        const root = {
            classList: { toggle },
            style: { colorScheme: '' }
        };

        expect(applyTheme(root, 'system', false)).toBe('light');
        expect(toggle).toHaveBeenCalledWith('dark', false);
        expect(root.style.colorScheme).toBe('light');
    });
});
