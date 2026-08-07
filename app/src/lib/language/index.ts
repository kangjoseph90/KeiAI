// Language registry and detection. The registry is the source of truth for
// known languages (ISO 639-1); detection wraps `tinyld/light`. The app UI
// language (i18n) will also draw from this registry in the future.

export {
    detectLanguage,
    detectSourceLanguage,
    resolveBidirectionalPair,
    resolveTranslationPair,
    type DetectOptions,
    type ResolveTranslationOptions
} from './detection';
export {
    getLanguage,
    getLanguageName,
    getLanguageNativeName,
    isLanguageCode,
    LANGUAGE_CODES,
    LANGUAGES
} from './registry';
export type { LanguageCode, LanguageEntry, ResolvedLanguagePair } from './types';
