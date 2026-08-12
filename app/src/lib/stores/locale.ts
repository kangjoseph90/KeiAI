import { deviceKV, type KeyValueStore } from '$lib/adapters/kv';
import { isUiLocale, resolveUiLocale, type UiLocale } from '$lib/language';
import { updateSettings } from './content/settings';
import { appLocale, deviceLocale } from './state';

export const LOCALE_PREFERENCE_KEY = 'pref:locale';

function getSystemLanguages(): readonly string[] {
    return typeof navigator === 'undefined' ? [] : navigator.languages;
}

export function loadLocalePreference(
    storage: KeyValueStore = deviceKV,
    systemLanguages: readonly string[] = getSystemLanguages()
): UiLocale {
    let stored: string | null = null;
    try {
        stored = storage.get(LOCALE_PREFERENCE_KEY);
    } catch {
        // Bootstrap must remain available when optional preference storage fails.
    }

    const locale = isUiLocale(stored) ? stored : resolveUiLocale(systemLanguages);
    deviceLocale.set(locale);
    return locale;
}

export function startLocalePreferenceCache(storage: KeyValueStore = deviceKV): () => void {
    return appLocale.subscribe((locale) => {
        deviceLocale.set(locale);
        try {
            storage.set(LOCALE_PREFERENCE_KEY, locale);
        } catch {
            // The synchronized setting remains authoritative if the bootstrap cache fails.
        }
    });
}

export async function updateAppLocale(
    locale: UiLocale,
    storage: KeyValueStore = deviceKV
): Promise<void> {
    await updateSettings({ ui: { locale } });
    deviceLocale.set(locale);
    try {
        storage.set(LOCALE_PREFERENCE_KEY, locale);
    } catch {
        // The synchronized setting remains authoritative if the bootstrap cache fails.
    }
}
