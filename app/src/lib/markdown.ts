/**
 * Markdown rendering configuration.
 * - breaks: true → single newline becomes <br>
 * - highlight.js → syntax highlighting for code blocks
 * - GFM → tables, strikethrough, task lists
 * - Setext headings and indented code blocks are disabled for chat compatibility
 * - KaTeX → LaTeX math with $...$, $$...$$, \(...\), and \[...\] delimiters
 */
import { Marked, type Token, type Tokenizer, type Tokens } from 'marked';
import hljs from 'highlight.js';
import katex from 'katex';

type MathKind = 'inline' | 'display';

interface MathToken extends Tokens.Generic {
    type: 'inlineMath' | 'blockMath';
    kind: MathKind;
    text: string;
}

// Dollar math requires space/punctuation boundaries on both sides
// (marked-katex-extension semantics) so money amounts like "$5이고 $3이다"
// stay literal. CJK-adjacent math ("$x^2$이다") stays literal too; use
// \(...\), which has no boundary requirements, in unspaced CJK prose.
const INLINE_DOLLAR_RULE =
    /^(\${1,2})(?!\$)((?:\\.|[^\\\n])*?(?:\\.|[^\\\n$]))\1(?=[\s?!.,:？！。，：]|$)/;
const INLINE_PAREN_RULE = /^\\\(((?:\\.|[^\\\n])+?)\\\)/;
const INLINE_BRACKET_RULE = /^\\\[((?:\\[\s\S]|[^\\])+?)\\\]/;

const BLOCK_DOLLAR_RULE = /^(\${1,2})\n((?:\\[^]|[^\\])+?)\n\1(?:\n|$)/;
const BLOCK_BRACKET_RULE = /^\\\[\n((?:\\[^]|[^\\])+?)\n\\\](?:\n|$)/;

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderMath(token: MathToken): string {
    try {
        return katex.renderToString(token.text, {
            displayMode: token.kind === 'display',
            throwOnError: true,
            strict: 'ignore'
        });
    } catch {
        return escapeHtml(token.raw);
    }
}

function earliestIndex(...indices: number[]): number | undefined {
    const candidates = indices.filter((index) => index >= 0);
    return candidates.length ? Math.min(...candidates) : undefined;
}

function findInlineDollarStart(src: string): number {
    let offset = 0;
    let rest = src;
    while (rest) {
        const index = rest.indexOf('$');
        if (index === -1) return -1;
        if (
            (index === 0 || rest.charAt(index - 1) === ' ') &&
            INLINE_DOLLAR_RULE.test(rest.substring(index))
        ) {
            return offset + index;
        }
        const stripped = rest.substring(index + 1).replace(/^\$+/, '');
        offset += rest.length - stripped.length;
        rest = stripped;
    }
    return -1;
}

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
        },
        {
            name: 'inlineMath',
            level: 'inline',
            start(src: string) {
                return earliestIndex(
                    findInlineDollarStart(src),
                    src.indexOf('\\('),
                    src.indexOf('\\[')
                );
            },
            tokenizer(src: string): MathToken | undefined {
                const dollar = src.match(INLINE_DOLLAR_RULE);
                if (dollar) {
                    return {
                        type: 'inlineMath',
                        raw: dollar[0],
                        text: dollar[2].trim(),
                        kind: dollar[1].length === 2 ? 'display' : 'inline'
                    };
                }

                const paren = src.match(INLINE_PAREN_RULE);
                if (paren) {
                    return {
                        type: 'inlineMath',
                        raw: paren[0],
                        text: paren[1].trim(),
                        kind: 'inline'
                    };
                }

                const bracket = src.match(INLINE_BRACKET_RULE);
                if (bracket) {
                    return {
                        type: 'inlineMath',
                        raw: bracket[0],
                        text: bracket[1].trim(),
                        kind: 'display'
                    };
                }

                return undefined;
            },
            renderer(token: Tokens.Generic) {
                return renderMath(token as MathToken);
            }
        },
        {
            name: 'blockMath',
            level: 'block',
            start(src: string) {
                return earliestIndex(src.search(/\n\${1,2}\n/), src.search(/\n\\\[\n/));
            },
            tokenizer(src: string): MathToken | undefined {
                const dollar = src.match(BLOCK_DOLLAR_RULE);
                if (dollar) {
                    return {
                        type: 'blockMath',
                        raw: dollar[0],
                        text: dollar[2].trim(),
                        kind: dollar[1].length === 2 ? 'display' : 'inline'
                    };
                }

                const bracket = src.match(BLOCK_BRACKET_RULE);
                if (bracket) {
                    return {
                        type: 'blockMath',
                        raw: bracket[0],
                        text: bracket[1].trim(),
                        kind: 'display'
                    };
                }

                return undefined;
            },
            renderer(token: Tokens.Generic) {
                return `${renderMath(token as MathToken)}\n`;
            }
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
