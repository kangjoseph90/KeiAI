import { describe, expect, it } from 'vitest';
import {
    getLanguage,
    getLanguageName,
    getLanguageNativeName,
    isLanguageCode,
    LANGUAGE_CODES,
    LANGUAGES
} from '$lib/language';

describe('LANGUAGES registry', () => {
    it('contains the expected core languages', () => {
        const codes = LANGUAGES.map((entry) => entry.code);
        for (const code of ['en', 'ko', 'ja', 'zh', 'es', 'fr', 'de']) {
            expect(codes, `${code} should be registered`).toContain(code);
        }
    });

    it('has unique codes', () => {
        const codes = LANGUAGES.map((entry) => entry.code);
        expect(new Set(codes).size).toBe(codes.length);
    });

    it('exposes codes derived from the registry', () => {
        expect(LANGUAGE_CODES.length).toBe(LANGUAGES.length);
        expect(LANGUAGE_CODES[0]).toBe('en');
    });
});

describe('isLanguageCode', () => {
    it('accepts known codes', () => {
        expect(isLanguageCode('en')).toBe(true);
        expect(isLanguageCode('ko')).toBe(true);
    });

    it('rejects unknown codes and non-strings', () => {
        expect(isLanguageCode('xx')).toBe(false);
        expect(isLanguageCode('')).toBe(false);
        expect(isLanguageCode(undefined)).toBe(false);
        expect(isLanguageCode(42)).toBe(false);
    });
});

describe('getLanguage / getLanguageName / getLanguageNativeName', () => {
    it('returns the entry for a known code', () => {
        expect(getLanguage('ko')).toEqual({
            code: 'ko',
            name: 'Korean',
            nativeName: '한국어'
        });
    });

    it('returns undefined for an unknown code', () => {
        expect(getLanguage('xx')).toBeUndefined();
    });

    it('falls back to the raw code for unknown names', () => {
        expect(getLanguageName('xx')).toBe('xx');
        expect(getLanguageNativeName('xx')).toBe('xx');
    });

    it('returns English and native names for known codes', () => {
        expect(getLanguageName('ja')).toBe('Japanese');
        expect(getLanguageNativeName('ja')).toBe('日本語');
    });
});
