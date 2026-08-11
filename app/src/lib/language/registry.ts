import type { LanguageCode, LanguageEntry } from './types';

// Languages the app knows about, keyed by ISO 639-1 code. Mirrors what
// `tinyld/light` can detect, so detections resolve back to an entry here.

export const LANGUAGES = [
    { code: 'en', name: 'English', nativeName: 'English' },
    { code: 'ko', name: 'Korean', nativeName: '한국어' },
    { code: 'ja', name: 'Japanese', nativeName: '日本語' },
    { code: 'zh', name: 'Chinese', nativeName: '中文' },
    { code: 'es', name: 'Spanish', nativeName: 'Español' },
    { code: 'fr', name: 'French', nativeName: 'Français' },
    { code: 'de', name: 'German', nativeName: 'Deutsch' },
    { code: 'pt', name: 'Portuguese', nativeName: 'Português' },
    { code: 'it', name: 'Italian', nativeName: 'Italiano' },
    { code: 'nl', name: 'Dutch', nativeName: 'Nederlands' },
    { code: 'ru', name: 'Russian', nativeName: 'Русский' },
    { code: 'pl', name: 'Polish', nativeName: 'Polski' },
    { code: 'el', name: 'Greek', nativeName: 'Ελληνικά' },
    { code: 'sv', name: 'Swedish', nativeName: 'Svenska' },
    { code: 'fi', name: 'Finnish', nativeName: 'Suomi' },
    { code: 'nb', name: 'Norwegian', nativeName: 'Norsk' },
    { code: 'hu', name: 'Hungarian', nativeName: 'Magyar' },
    { code: 'ro', name: 'Romanian', nativeName: 'Română' },
    { code: 'tr', name: 'Turkish', nativeName: 'Türkçe' },
    { code: 'th', name: 'Thai', nativeName: 'ไทย' },
    { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी' },
    { code: 'bn', name: 'Bengali', nativeName: 'বাংলা' },
    { code: 'ar', name: 'Arabic', nativeName: 'العربية', direction: 'rtl' },
    { code: 'he', name: 'Hebrew', nativeName: 'עברית', direction: 'rtl' }
] as const satisfies readonly LanguageEntry[];

/** All known language codes, derived from the registry. */
export const LANGUAGE_CODES = LANGUAGES.map((entry) => entry.code) as readonly LanguageCode[];

const LANGUAGE_BY_CODE: ReadonlyMap<LanguageCode, LanguageEntry> = new Map(
    LANGUAGES.map((entry) => [entry.code, entry])
);

export function getLanguage(code: LanguageCode): LanguageEntry | undefined {
    return LANGUAGE_BY_CODE.get(code);
}

export function getLanguageName(code: LanguageCode): string {
    return LANGUAGE_BY_CODE.get(code)?.name ?? code;
}

export function getLanguageNativeName(code: LanguageCode): string {
    const entry = LANGUAGE_BY_CODE.get(code);
    return entry?.nativeName ?? entry?.name ?? code;
}

export function getLanguageDirection(code: LanguageCode): 'ltr' | 'rtl' {
    return LANGUAGE_BY_CODE.get(code)?.direction ?? 'ltr';
}

export function isLanguageCode(value: unknown): value is LanguageCode {
    return typeof value === 'string' && LANGUAGE_BY_CODE.has(value);
}
