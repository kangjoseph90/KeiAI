/** Languages with a complete app UI message catalog. */
export const UI_LOCALES = ['en', 'ko'] as const;

export type UiLocale = (typeof UI_LOCALES)[number];

export function isUiLocale(value: unknown): value is UiLocale {
    return typeof value === 'string' && UI_LOCALES.some((locale) => locale === value);
}

export function resolveUiLocale(languages: readonly string[]): UiLocale {
    for (const language of languages) {
        const base = language.trim().toLowerCase().split('-')[0];
        if (isUiLocale(base)) return base;
    }
    return 'en';
}
