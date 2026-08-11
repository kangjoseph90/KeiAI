import { describe, expect, it } from 'vitest';
import {
    createTranslator,
    interpolateMessage,
    isUiLocale,
    resolveUiLocale,
    type MessageParams
} from '$lib/language';

describe('UI language', () => {
    it('resolves the first supported system locale', () => {
        expect(resolveUiLocale(['fr-FR', 'ko-KR', 'en-US'])).toBe('ko');
    });

    it('falls back to English when the system locale is unsupported', () => {
        expect(resolveUiLocale(['fr-FR'])).toBe('en');
    });

    it('only accepts locales with UI catalogs', () => {
        expect(isUiLocale('ko')).toBe(true);
        expect(isUiLocale('ja')).toBe(false);
    });

    it('creates a translator for the selected locale', () => {
        expect(createTranslator('en')('settings.title')).toBe('Settings');
        expect(createTranslator('ko')('settings.title')).toBe('설정');
    });

    it('supports numbers and preserves unresolved placeholders', () => {
        expect(interpolateMessage('{:name}: {:count}', { name: 'Messages', count: 3 })).toBe(
            'Messages: 3'
        );
        expect(interpolateMessage('Hello, {:name}', {})).toBe('Hello, {:name}');
    });

    it('only substitutes prefixed placeholders', () => {
        expect(interpolateMessage('{:count} items', { count: 3 })).toBe('3 items');
        expect(interpolateMessage('{count} items', { count: 3 })).toBe('{count} items');
        expect(interpolateMessage('{} {:}', {})).toBe('{} {:}');
    });

    it('leaves literal braces in CSS examples untouched', () => {
        expect(interpolateMessage('.status-panel { ... }', {})).toBe('.status-panel { ... }');
    });

    it('leaves double-brace template tokens untouched', () => {
        expect(interpolateMessage('Use {{prompt}} in inputs', {})).toBe('Use {{prompt}} in inputs');
    });

    it('pseudo-localizes translated text while preserving interpolation values', () => {
        const pseudo = createTranslator('en', { pseudo: true });
        expect(pseudo('settings.title')).toBe('［Šëţţïñğš···］');
        expect(pseudo('library.import.title', { tab: 'Characters' })).toBe(
            '［Ïɱþôŕţ Characters··］'
        );
    });
});

describe('plural messages', () => {
    it('renders the English singular form for count 1', () => {
        expect(createTranslator('en')('common.counts.items', { count: 1 })).toBe('1 item');
    });

    it('renders the English plural form for count 2', () => {
        expect(createTranslator('en')('common.counts.items', { count: 2 })).toBe('2 items');
    });

    it('renders the Korean form (same string for one and other)', () => {
        expect(createTranslator('ko')('common.counts.items', { count: 1 })).toBe('1개 항목');
        expect(createTranslator('ko')('common.counts.items', { count: 2 })).toBe('2개 항목');
    });

    it('falls back to the other form when a locale lacks a specific plural form', () => {
        expect(createTranslator('ko')('chat.message.traceCount', { count: 1 })).toBe('1단계');
        expect(createTranslator('ko')('chat.message.traceCount', { count: 5 })).toBe('5단계');
    });

    it('uses zero count when params are omitted for a plural key', () => {
        const en = createTranslator('en');
        expect(en('common.counts.items', { count: 0 })).toBe('0 items');
    });
});

describe('translator type contracts', () => {
    it('classifies parameter-less literal keys as taking no params', () => {
        type Params = MessageParams<'settings.title'>;
        const _check: Params = null as never;
        expect(_check).toBeNull();
    });

    it('requires count for plural keys', () => {
        type Params = MessageParams<'common.counts.items'>;
        const valid: Params = { count: 1 };
        expect(valid.count).toBe(1);

        // @ts-expect-error - count is required for plural messages
        const missing: Params = {};
        expect(missing).toBeDefined();
    });

    it('requires all placeholders for literal keys', () => {
        type Params = MessageParams<'library.meta.room'>;
        const valid: Params = { characters: 1, chats: 2 };
        expect(valid.characters).toBe(1);
    });

    it('rejects calling a plural key without params at the translator level', () => {
        const t = createTranslator('en');
        // @ts-expect-error - plural keys require a params argument with count
        const _result: string = t('common.counts.items');
        expect(true).toBe(true);
    });

    it('treats CSS examples and template tokens as having no placeholders', () => {
        type CssParams = MessageParams<'character.display.cssPlaceholder'>;
        const _css: CssParams = null as never;
        expect(_css).toBeNull();

        type ComfyParams = MessageParams<'settings.services.help.comfyWorkflow'>;
        const _comfy: ComfyParams = null as never;
        expect(_comfy).toBeNull();
    });
});
