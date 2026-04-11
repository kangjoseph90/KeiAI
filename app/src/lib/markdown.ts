/**
 * Markdown rendering configuration.
 * - breaks: true → single newline becomes <br>
 * - highlight.js → syntax highlighting for code blocks
 * - GFM → tables, strikethrough, task lists
 */
import { Marked } from 'marked';
import hljs from 'highlight.js';

const markedInstance = new Marked({
	breaks: true,
	gfm: true,
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
