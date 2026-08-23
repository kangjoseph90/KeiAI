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

describe('Markdown LaTeX math', () => {
    it('renders inline math from dollar delimiters', () => {
        const rendered = parseMarkdown('일반 **Markdown**과 $x^2$ 수식');

        expect(rendered).toContain('<span class="katex');
        expect(rendered).toContain('<annotation encoding=');
        expect(rendered).not.toContain('$x^2$');
    });

    it('renders inline math from backslash-paren delimiters', () => {
        const rendered = parseMarkdown('Einstein says \\(E = mc^2\\) here');

        expect(rendered).toContain('<span class="katex');
        expect(rendered).not.toContain('\\(E');
        expect(rendered).not.toContain('class="katex-display"');
    });

    it('renders single-line display math from double dollars', () => {
        const rendered = parseMarkdown('$$x^2$$');

        expect(rendered).toContain('class="katex-display"');
    });

    it('renders display math from bracket delimiters', () => {
        const rendered = parseMarkdown(
            'before\n\n\\[\n\\int_0^\\infty e^{-x} dx = 1\n\\]\n\nafter'
        );

        expect(rendered).toContain('class="katex-display"');
        expect(rendered).toContain('<p>before</p>');
        expect(rendered).toContain('<p>after</p>');
    });

    it('renders inline math inside list items and mixed Markdown', () => {
        const rendered = parseMarkdown('- 리스트 안의 $a+b$\n- **강조** $c-d$');

        expect(rendered).toContain('<li>리스트 안의 <span class="katex');
        expect(rendered).toContain('<strong>강조</strong>');
    });

    it('keeps math delimiters inside inline code literal', () => {
        const rendered = parseMarkdown('inline `code $not_math$` end');

        expect(rendered).toContain('<code>code $not_math$</code>');
        expect(rendered).not.toContain('<span class="katex');
    });

    it('keeps math delimiters inside fenced code blocks literal', () => {
        const rendered = parseMarkdown('```ts\nconst value = "$not_math$";\n```');

        expect(rendered).toContain('<pre><code');
        expect(rendered).toContain('$not_math$');
        expect(rendered).not.toContain('<span class="katex');
    });

    it('keeps escaped dollars literal', () => {
        const rendered = parseMarkdown('cost \\$5 and \\$6 total');

        expect(rendered).toContain('cost $5 and $6 total');
        expect(rendered).not.toContain('<span class="katex');
    });

    it('keeps plain dollar amounts literal', () => {
        const rendered = parseMarkdown('I paid $5 and received $6 in change.');

        expect(rendered).not.toContain('<span class="katex');
    });

    it('falls back to raw text for malformed math without breaking the message', () => {
        const rendered = parseMarkdown('broken $\\frac{$ math and **bold** tail');

        expect(rendered).toContain('broken $\\frac{$ math');
        expect(rendered).toContain('<strong>bold</strong>');
        expect(rendered).not.toContain('katex-error');
    });

    it('keeps an incomplete streaming formula as plain text', () => {
        expect(parseMarkdown('The equation is $x^2 +')).not.toContain('<span class="katex');

        const completed = parseMarkdown('The equation is $x^2 + y^2$ done');
        expect(completed).toContain('<span class="katex');
        expect(completed).toContain('done');
    });

    it('renders several formulas in one message', () => {
        const rendered = parseMarkdown(
            'First $a$ then $b$, plus\n\n$$\n\\frac{a}{b}\n$$\n\nand \\(c\\) last'
        );

        expect(rendered.match(/<span class="katex"/g)).toHaveLength(4);
        expect(rendered).toContain('class="katex-display"');
    });

    it('interrupts a paragraph with a display math block', () => {
        const rendered = parseMarkdown('Intro text\n$$\nx^2\n$$\ntail');

        expect(rendered).toContain('<p>Intro text</p>');
        expect(rendered).toContain('class="katex-display"');
        expect(rendered).toContain('<p>tail</p>');
    });

    it('does not treat dialogue quotes around math as quote marks only', () => {
        const rendered = parseMarkdown('"The value $x$ is unknown"');

        expect(rendered).toContain('data-keiai-quote="double"');
        expect(rendered).toContain('<span class="katex');
    });
});

describe('Markdown dollar delimiters in CJK text', () => {
    it('keeps CJK-adjacent single-dollar delimiters literal', () => {
        expect(parseMarkdown('값은$x^2$이다')).not.toContain('<span class="katex');

        // Korean particles also attach directly after the closing delimiter,
        // which fails the whitespace/punctuation boundary on purpose.
        expect(parseMarkdown('$x^2$이다')).not.toContain('<span class="katex');
        expect(parseMarkdown('$x^2$입니다')).not.toContain('<span class="katex');
    });

    it('renders single-dollar math with spaced or punctuated boundaries', () => {
        expect(parseMarkdown('값은 $x^2$ 이다')).toContain('<span class="katex');
        expect(parseMarkdown('값은 $x^2$.')).toContain('<span class="katex');
    });

    it('keeps Korean money amounts with attached particles literal', () => {
        const rendered = parseMarkdown('커피 $5이고 빵 $3이다');

        expect(rendered).not.toContain('<span class="katex');
    });

    it('supports backslash-paren math without boundary requirements', () => {
        expect(parseMarkdown('값은\\(x^2\\)이다')).toContain('<span class="katex');
    });
});
