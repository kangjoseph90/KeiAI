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

describe('Markdown dialogue quotes', () => {
    it('marks paired straight and curly quotes by kind', () => {
        const rendered = parseMarkdown('"Hello" \'aside\' “Welcome” ‘quietly’');

        expect(rendered).toContain('<mark data-keiai-quote="double">"Hello"</mark>');
        expect(rendered).toContain('<mark data-keiai-quote="single">\'aside\'</mark>');
        expect(rendered).toContain('<mark data-keiai-quote="double">“Welcome”</mark>');
        expect(rendered).toContain('<mark data-keiai-quote="single">‘quietly’</mark>');
    });

    it('renders Markdown inside a quote', () => {
        const rendered = parseMarkdown('"Hello, **really**."');

        expect(rendered).toContain(
            '<mark data-keiai-quote="double">"Hello, <strong>really</strong>."</mark>'
        );
    });

    it('does not treat apostrophes as single-quoted dialogue', () => {
        const rendered = parseMarkdown("Don't change Alice's reply.");

        expect(rendered).not.toContain('data-keiai-quote');
        expect(rendered).toContain('Don&#39;t change Alice&#39;s reply.');
    });

    it('leaves escaped, code, and unmatched quotes unmarked', () => {
        const rendered = parseMarkdown(
            '\\"escaped\\" `"inline"`\n\n```text\n"fenced"\n```\n\n"open'
        );

        expect(rendered).not.toContain('data-keiai-quote');
        expect(rendered).toContain('<code>&quot;inline&quot;</code>');
        expect(rendered).toContain('&quot;open');
    });

    it('keeps a partial streaming quote plain until it closes', () => {
        expect(parseMarkdown('"partial')).not.toContain('data-keiai-quote');
        expect(parseMarkdown('"partial"')).toContain('data-keiai-quote="double"');
    });

    it('supports an apostrophe inside single-quoted dialogue', () => {
        const rendered = parseMarkdown("'I don't know.'");

        expect(rendered).toContain('<mark data-keiai-quote="single">\'I don&#39;t know.\'</mark>');
    });
});
