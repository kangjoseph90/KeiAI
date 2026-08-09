/**
 * Markdown rendering configuration.
 * - breaks: true → single newline becomes <br>
 * - highlight.js → syntax highlighting for code blocks
 * - GFM → tables, strikethrough, task lists
 * - Setext headings and indented code blocks are disabled for chat compatibility
 */
import { Marked, type Token, type Tokenizer, type Tokens } from 'marked';
import hljs from 'highlight.js';

type QuoteKind = 'single' | 'double';

interface QuoteToken extends Tokens.Generic {
    type: 'quote';
    kind: QuoteKind;
    open: string;
    close: string;
    tokens: Token[];
}

const QUOTE_PAIRS: Readonly<Record<string, { close: string; kind: QuoteKind }>> = {
    '"': { close: '"', kind: 'double' },
    "'": { close: "'", kind: 'single' },
    '“': { close: '”', kind: 'double' },
    '‘': { close: '’', kind: 'single' }
};

function isAsciiWord(character: string | undefined): boolean {
    return character !== undefined && /[A-Za-z0-9]/.test(character);
}

function previousSourceCharacter(tokens: Token[]): string | undefined {
    const raw = tokens.at(-1)?.raw;
    return raw?.at(-1);
}

function findClosingQuote(src: string, open: string, close: string, kind: QuoteKind): number {
    for (let index = 1; index < src.length; index += 1) {
        const character = src[index];
        if (character === '\n' || character === '\r') return -1;

        if (character === '\\') {
            index += 1;
            continue;
        }
        if (character !== close) continue;

        if (
            open === "'" &&
            kind === 'single' &&
            isAsciiWord(src[index - 1]) &&
            isAsciiWord(src[index + 1])
        ) {
            continue;
        }

        return index;
    }

    return -1;
}

const markedInstance = new Marked({
    breaks: true,
    gfm: true,
    extensions: [
        {
            name: 'quote',
            level: 'inline',
            start(src: string) {
                const index = src.search(/["'“‘]/);
                return index >= 0 ? index : undefined;
            },
            tokenizer(src: string, tokens: Token[]): QuoteToken | undefined {
                const open = src[0];
                const pair = QUOTE_PAIRS[open];
                if (!pair || /^\s$/u.test(src[1] ?? '')) return undefined;

                if (open === "'" && isAsciiWord(previousSourceCharacter(tokens))) {
                    return undefined;
                }

                const closeIndex = findClosingQuote(src, open, pair.close, pair.kind);
                if (closeIndex < 0) return undefined;

                const raw = src.slice(0, closeIndex + 1);
                const content = src.slice(1, closeIndex);
                if (!content) return undefined;

                return {
                    type: 'quote',
                    raw,
                    kind: pair.kind,
                    open,
                    close: pair.close,
                    tokens: this.lexer.inlineTokens(content)
                };
            },
            renderer(token: Tokens.Generic) {
                const quote = token as QuoteToken;
                return `<mark data-keiai-quote="${quote.kind}">${quote.open}${this.parser.parseInline(quote.tokens)}${quote.close}</mark>`;
            },
            childTokens: ['tokens']
        }
    ],
    tokenizer: {
        lheading(this: Tokenizer, src: string): Tokens.Heading | undefined {
            const match = this.rules.block.lheading.exec(src);
            if (!match) return undefined;

            return {
                type: 'paragraph',
                raw: `${match[1]}\n`,
                text: match[1],
                tokens: this.lexer.inline(match[1])
            } as unknown as Tokens.Heading;
        },
        code(this: Tokenizer, src: string): Tokens.Code | undefined {
            const match = this.rules.block.code.exec(src);
            if (!match) return undefined;

            const raw = match[0];
            const text = raw.replace(this.rules.other.codeRemoveIndent, '').replace(/\n+$/, '');

            if (/^\s*</.test(text)) {
                return {
                    type: 'html',
                    raw,
                    pre: false,
                    text,
                    block: true
                } as unknown as Tokens.Code;
            }

            return {
                type: 'paragraph',
                raw,
                text,
                tokens: this.lexer.inline(text)
            } as unknown as Tokens.Code;
        }
    },
    renderer: {
        code({ text, lang }: { text: string; lang?: string }) {
            const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
            const highlighted = hljs.highlight(text, { language }).value;
            return `<pre><code class="hljs language-${language}">${highlighted}</code></pre>`;
        }
    }
});

export function parseMarkdown(content: string): string {
    return markedInstance.parse(content) as string;
}

export async function parseMarkdownAsync(content: string): Promise<string> {
    return (await markedInstance.parse(content)) as string;
}
