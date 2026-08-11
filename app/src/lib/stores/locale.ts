import { appKV, type IKeyValueAdapter } from '$lib/adapters/kv';
import { isUiLocale, resolveUiLocale, type UiLocale } from '$lib/language';
import { updateSettings } from './content/settings';
import { appLocale, deviceLocale } from './state';

export const LOCALE_PREFERENCE_KEY = 'pref:locale';

function getSystemLanguages(): readonly string[] {
    return typeof navigator === 'undefined' ? [] : navigator.languages;
}

export async function loadLocalePreference(
    storage: IKeyValueAdapter = appKV,
    systemLanguages: readonly string[] = getSystemLanguages()
): Promise<UiLocale> {
    let stored: string | null = null;
    try {
        stored = await storage.get(LOCALE_PREFERENCE_KEY);
    } catch {
        // Bootstrap must remain available when optional preference storage fails.
    }

    const locale = isUiLocale(stored) ? stored : resolveUiLocale(systemLanguages);
    deviceLocale.set(locale);
    return locale;
}

export function startLocalePreferenceCache(storage: IKeyValueAdapter = appKV): () => void {
    return appLocale.subscribe((locale) => {
        deviceLocale.set(locale);
        void storage.set(LOCALE_PREFERENCE_KEY, locale).catch(() => undefined);
    });
}

export async function updateAppLocale(
    locale: UiLocale,
    storage: IKeyValueAdapter = appKV
): Promise<void> {
    await updateSettings({ ui: { locale } });
    deviceLocale.set(locale);
    await storage.set(LOCALE_PREFERENCE_KEY, locale).catch(() => undefined);
}
