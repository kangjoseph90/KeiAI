import { describe, expect, it } from 'vitest';
import {
    detectLanguage,
    detectSourceLanguage,
    resolveBidirectionalPair,
    resolveTranslationPair
} from '$lib/language';

describe('detectLanguage', () => {
    it('detects common languages', () => {
        expect(detectLanguage('Hello world, this is english text.')).toBe('en');
        expect(detectLanguage('안녕하세요 반갑습니다.')).toBe('ko');
        expect(detectLanguage('こんにちは、これは日本語です。')).toBe('ja');
        expect(detectLanguage('Hola, esto es un texto en español.')).toBe('es');
    });

    it('returns undefined for empty or whitespace text', () => {
        expect(detectLanguage('')).toBeUndefined();
        expect(detectLanguage('   ')).toBeUndefined();
    });

    it('constrains detection to the given candidates', () => {
        expect(
            detectLanguage('Hello world, this is english text.', { only: ['ko', 'ja'] })
        ).toBeUndefined();
    });
});

describe('detectSourceLanguage', () => {
    it('returns the detected language', () => {
        expect(detectSourceLanguage('안녕하세요 반갑습니다.', 'en')).toBe('ko');
    });

    it('falls back when detection is inconclusive', () => {
        expect(detectSourceLanguage('', 'en')).toBe('en');
        expect(detectSourceLanguage('   ', 'ko')).toBe('ko');
    });
});

describe('resolveBidirectionalPair', () => {
    it('keeps target->secondary when the text matches the target language', () => {
        expect(resolveBidirectionalPair('안녕하세요 반갑습니다.', 'ko', 'en')).toEqual({
            source: 'ko',
            target: 'en'
        });
    });

    it('flips to secondary->target when the text matches the secondary language', () => {
        expect(resolveBidirectionalPair('Hello world, this is english.', 'ko', 'en')).toEqual({
            source: 'en',
            target: 'ko'
        });
    });

    it('falls back to target->secondary when detection is inconclusive', () => {
        expect(resolveBidirectionalPair('', 'ko', 'en')).toEqual({ source: 'ko', target: 'en' });
    });

    it('does not flip when the two languages are identical', () => {
        expect(resolveBidirectionalPair('안녕하세요', 'ko', 'ko')).toEqual({
            source: 'ko',
            target: 'ko'
        });
    });
});

describe('resolveTranslationPair', () => {
    it('detects source with target as fallback when bidirectional is off', () => {
        expect(
            resolveTranslationPair('안녕하세요 반갑습니다.', {
                targetLanguage: 'ko',
                bidirectional: false,
                secondaryLanguage: 'en'
            })
        ).toEqual({ source: 'ko', target: 'ko' });
    });

    it('uses target as fallback when detection fails in single mode', () => {
        expect(
            resolveTranslationPair('', {
                targetLanguage: 'ko',
                bidirectional: false,
                secondaryLanguage: 'en'
            })
        ).toEqual({ source: 'ko', target: 'ko' });
    });

    it('delegates to bidirectional resolution when enabled', () => {
        expect(
            resolveTranslationPair('Hello world, this is english.', {
                targetLanguage: 'ko',
                bidirectional: true,
                secondaryLanguage: 'en'
            })
        ).toEqual({ source: 'en', target: 'ko' });
    });
});
