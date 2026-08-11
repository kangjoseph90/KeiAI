// Shared language entry point for content-language detection and app UI messages.
// The registry remains the source of truth for language metadata.

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
    getLanguageDirection,
    getLanguageName,
    getLanguageNativeName,
    isLanguageCode,
    LANGUAGE_CODES,
    LANGUAGES
} from './registry';
export {
    createTranslator,
    getUiLocaleDirection,
    interpolateMessage,
    isUiLocale,
    resolveUiLocale,
    UI_LOCALES
} from './ui/index';
export type {
    UiLocale,
    InterpolationValue,
    MessageParams,
    Translator,
    MessageKey
} from './ui/index';
export type { LanguageCode, LanguageEntry, ResolvedLanguagePair } from './types';
