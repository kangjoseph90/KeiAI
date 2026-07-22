import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '$lib/markdown';

describe('Markdown code blocks', () => {
    it('does not turn four-space indentation into a code block', () => {
        const rendered = parseMarkdown('    indented text');

        expect(rendered).not.toContain('<pre>');
        expect(rendered).toContain('<p>indented text</p>');
    });

    it('keeps fenced code blocks', () => {
        const rendered = parseMarkdown('```html\n<div>code</div>\n```');

        expect(rendered).toContain('<pre><code class="hljs language-html">');
        expect(rendered).toContain('code');
    });

    it('keeps indented HTML as HTML inside a raw HTML container', () => {
        const rendered = parseMarkdown(`<div class="stats-grid">

    <div class="stat-item">
        <span>Speed</span>
    </div>

</div>`);

        expect(rendered).not.toContain('<pre>');
        expect(rendered).toContain('<div class="stat-item">');
        expect(rendered).toContain('<span>Speed</span>');
    });
});

describe('Markdown headings', () => {
    it('does not turn a setext underline into a heading', () => {
        const rendered = parseMarkdown('Status\n---');

        expect(rendered).not.toContain('<h2>');
        expect(rendered).toContain('<p>Status</p>');
        expect(rendered).toContain('<hr>');
    });

    it('keeps ATX headings', () => {
        expect(parseMarkdown('# Status')).toContain('<h1>Status</h1>');
    });
});
