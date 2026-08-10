import { describe, expect, it } from 'vitest';
import { createAssetUri } from '$lib/services/asset';
import { parseMarkdownAsync } from '$lib/markdown';
import {
    protectHtmlStyles,
    restoreHtmlStyles,
    sanitizeWithStyle,
    scopeCss,
    scopeStyleBlocks
} from '$lib/utils/style';

describe('style scoping', () => {
    const scope = '[data-keiai-message-scope="message-1"]';

    it('scopes selectors after import statements', () => {
        const css = scopeCss(
            "@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700&display=swap'); body { padding: 15px; } .status-window { color: red; }",
            scope
        );

        expect(css).toContain(
            "@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700&display=swap');"
        );
        expect(css).toContain(`${scope} body { padding: 15px; }`);
        expect(css).toContain(`${scope} .status-window { color: red; }`);
        expect(css).not.toMatch(/(^|})\s*body\s*\{/);
    });

    it('prefixes document-root selectors without applying them to the scope itself', () => {
        const css = scopeCss(
            'html body { margin: 0; } body.theme { color: red; } :root > .panel { padding: 1rem; }',
            scope
        );

        expect(css).toContain(`${scope} html body { margin: 0; }`);
        expect(css).toContain(`${scope} body.theme { color: red; }`);
        expect(css).toContain(`${scope} :root > .panel { padding: 1rem; }`);
        expect(css).not.toContain(`${scope} {`);
    });

    it('handles selector-list commas inside functional pseudo classes', () => {
        const css = scopeCss(':is(.one, .two) > .item, [data-value="a,b"] { color: red; }', scope);

        expect(css).toContain(`${scope} :is(.one, .two) > .item`);
        expect(css).toContain(`${scope} [data-value="a,b"]`);
    });

    it('scopes rules inside conditional at-rules but not keyframe steps', () => {
        const css = scopeCss(
            '@media (max-width: 768px) { body { padding: 5px; } } @keyframes fade { from { opacity: 0; } 50% { opacity: .5; } to { opacity: 1; } }',
            scope
        );

        expect(css).toContain(`@media (max-width: 768px) { ${scope} body { padding: 5px; } }`);
        expect(css).toContain('@keyframes fade { from { opacity: 0; }');
        expect(css).not.toContain(`${scope} from`);
        expect(css).not.toContain(`${scope} 50%`);
    });

    it('fails closed when the stylesheet cannot be parsed', () => {
        expect(scopeCss('body { color: red;', scope)).toBe('');
    });

    it('scopes embedded styles without changing the surrounding HTML', () => {
        const html = scopeStyleBlocks(
            '<p>Before</p><style>.status-window { color: red; }</style><div class="status-window">Ready</div>',
            scope
        );

        expect(html).toContain(`<style>${scope} .status-window { color: red; }</style>`);
        expect(html).toContain('<p>Before</p>');
        expect(html).toContain('<div class="status-window">Ready</div>');
    });

    it('preserves internal asset URIs', () => {
        const uri = createAssetUri({
            scopeType: 'user',
            scopeId: 'user-1',
            ownerTable: 'characters',
            ownerId: 'character-1',
            hash: 'hash-1',
            encKey: 'key-1'
        });
        const sanitized = sanitizeWithStyle(`<img src="${uri}">`);

        expect(sanitized).toContain(`src="${uri}"`);
    });

    it('preserves semantic quote markers from Markdown rendering', async () => {
        const markdown = await parseMarkdownAsync('"Dialogue"');
        const sanitized = sanitizeWithStyle(markdown);

        expect(sanitized).toContain('<mark data-keiai-quote="double">');
    });

    it('preserves a style block at the start of rendered message HTML', async () => {
        const input =
            '<style>.container { display: grid; place-items: center; width: 100%; }</style><div class="container">Content</div>';
        const scoped = scopeStyleBlocks(input, scope);
        const protectedHtml = protectHtmlStyles(scoped);
        const markdown = await parseMarkdownAsync(protectedHtml.text);
        const restored = restoreHtmlStyles(markdown, protectedHtml.styles);
        const sanitized = sanitizeWithStyle(restored);

        expect(sanitized).toContain(`<style>${scope} .container`);
        expect(sanitized).toContain('<div class="container">Content</div>');
    });
});
