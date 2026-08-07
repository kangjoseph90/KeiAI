import { detect } from 'tinyld/light';
import type { LanguageCode, ResolvedLanguagePair } from './types';
import { isLanguageCode } from './registry';

export interface DetectOptions {
    /** Constrain detection to these candidates. */
    only?: readonly LanguageCode[];
}

/** Detects the language of `text`, returning a registry code or `undefined`. */
export function detectLanguage(text: string, options?: DetectOptions): LanguageCode | undefined {
    const detected = detect(text, options?.only ? { only: [...options.only] } : undefined);
    if (!detected || !isLanguageCode(detected)) return undefined;
    return detected;
}

/**
 * Detects the source language of `text`, falling back to `fallback` when
 * detection is inconclusive or yields no registry code.
 */
export function detectSourceLanguage(text: string, fallback: LanguageCode): LanguageCode {
    return detectLanguage(text) ?? fallback;
}

/**
 * Resolves the source/target pair for bidirectional translation across two
 * configured languages. The detected language becomes the source and the other
 * the target; inconclusive detection falls back to target->secondary.
 */
export function resolveBidirectionalPair(
    text: string,
    targetLanguage: LanguageCode,
    secondaryLanguage: LanguageCode
): ResolvedLanguagePair {
    if (targetLanguage === secondaryLanguage) {
        return { source: targetLanguage, target: secondaryLanguage };
    }
    const detected = detectLanguage(text, { only: [targetLanguage, secondaryLanguage] });
    if (detected === secondaryLanguage) {
        return { source: secondaryLanguage, target: targetLanguage };
    }
    return { source: targetLanguage, target: secondaryLanguage };
}

export interface ResolveTranslationOptions {
    /** Always-shown primary target language. */
    targetLanguage: LanguageCode;
    /** Whether bidirectional translation is enabled. */
    bidirectional: boolean;
    /** Second language, used only when `bidirectional` is on. */
    secondaryLanguage: LanguageCode;
}

/**
 * Resolves the source/target pair for a translation run from app settings.
 * In bidirectional mode the detected language picks the direction; otherwise
 * the source is detected (falling back to the target language).
 */
export function resolveTranslationPair(
    text: string,
    options: ResolveTranslationOptions
): ResolvedLanguagePair {
    const { targetLanguage, bidirectional, secondaryLanguage } = options;
    return bidirectional
        ? resolveBidirectionalPair(text, targetLanguage, secondaryLanguage)
        : {
              source: detectSourceLanguage(text, targetLanguage),
              target: targetLanguage
          };
}
