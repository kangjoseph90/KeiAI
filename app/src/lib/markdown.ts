/**
 * Markdown rendering configuration.
 * - breaks: true → single newline becomes <br>
 * - highlight.js → syntax highlighting for code blocks
 * - GFM → tables, strikethrough, task lists
 * - Setext headings and indented code blocks are disabled for chat compatibility
 */
import { Marked, type Tokenizer, type Tokens } from 'marked';
import hljs from 'highlight.js';

const markedInstance = new Marked({
    breaks: true,
    gfm: true,
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
