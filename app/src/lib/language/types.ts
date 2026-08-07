// ─── Types ─────────────────────────────────────────────────────────────

/** ISO 639-1 code (e.g. 'en', 'ko', 'ja'). */
export type LanguageCode = string;

export interface LanguageEntry {
    code: LanguageCode;
    /** English display name. */
    name: string;
    /** Endonym (native name). */
    nativeName: string;
}

export interface ResolvedLanguagePair {
    source: LanguageCode;
    target: LanguageCode;
}
