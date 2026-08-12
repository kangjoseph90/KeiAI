import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import type { KeyValueStore } from '$lib/adapters/kv';
import { appLocale, appSettings, deviceLocale } from '$lib/stores/state';
import { LOCALE_PREFERENCE_KEY, loadLocalePreference, updateAppLocale } from '$lib/stores/locale';
import { makeSettings } from '../../utils';

vi.mock('$lib/stores/content/settings', () => ({
    updateSettings: vi.fn()
}));

import { updateSettings } from '$lib/stores/content/settings';

function createStorage(value: string | null = null): KeyValueStore {
    return {
        get: vi.fn().mockReturnValue(value),
        set: vi.fn(),
        remove: vi.fn(),
        keys: vi.fn().mockReturnValue([])
    };
}

describe('locale preference', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        appSettings.set(null);
        deviceLocale.set('en');
    });

    it('uses the cached locale for bootstrap', async () => {
        const storage = createStorage('ko');

        expect(loadLocalePreference(storage, ['en-US'])).toBe('ko');
        expect(storage.get).toHaveBeenCalledWith(LOCALE_PREFERENCE_KEY);
        expect(get(appLocale)).toBe('ko');
    });

    it('detects a supported system locale when the cache is invalid', async () => {
        expect(loadLocalePreference(createStorage('ja'), ['ko-KR'])).toBe('ko');
    });

    it('prefers the synchronized app setting after it loads', async () => {
        loadLocalePreference(createStorage('ko'), ['ko-KR']);
        appSettings.set(makeSettings({ ui: { locale: 'en' } }));

        expect(get(appLocale)).toBe('en');
    });

    it('updates synchronized settings and the bootstrap cache', async () => {
        const storage = createStorage();

        await updateAppLocale('ko', storage);

        expect(updateSettings).toHaveBeenCalledWith({ ui: { locale: 'ko' } });
        expect(storage.set).toHaveBeenCalledWith(LOCALE_PREFERENCE_KEY, 'ko');
        expect(get(deviceLocale)).toBe('ko');
    });
});
