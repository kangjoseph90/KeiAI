import { appKV, type IKeyValueAdapter } from '$lib/adapters/kv';
import { themePreference } from './state';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = Exclude<ThemePreference, 'system'>;

export const THEME_PREFERENCE_KEY = 'pref:theme';

interface ThemeRoot {
    classList: Pick<DOMTokenList, 'toggle'>;
    style: Pick<CSSStyleDeclaration, 'colorScheme'>;
}

export function isThemePreference(value: unknown): value is ThemePreference {
    return value === 'light' || value === 'dark' || value === 'system';
}

export async function loadThemePreference(storage: IKeyValueAdapter = appKV): Promise<void> {
    try {
        const stored = await storage.get(THEME_PREFERENCE_KEY);
        themePreference.set(isThemePreference(stored) ? stored : 'system');
    } catch {
        themePreference.set('system');
    }
}

export async function updateThemePreference(
    preference: ThemePreference,
    storage: IKeyValueAdapter = appKV
): Promise<void> {
    await storage.set(THEME_PREFERENCE_KEY, preference);
    themePreference.set(preference);
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
    return preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;
}

export function applyTheme(
    root: ThemeRoot,
    preference: ThemePreference,
    systemDark: boolean
): ResolvedTheme {
    const resolved = resolveTheme(preference, systemDark);
    root.classList.toggle('dark', resolved === 'dark');
    root.style.colorScheme = resolved;
    return resolved;
}
