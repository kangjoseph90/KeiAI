const STYLE_BLOCK_REGEX = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;

export function extractStyleCSS(html: string): string {
    const blocks: string[] = [];
    for (const match of html.matchAll(STYLE_BLOCK_REGEX)) {
        const css = match[1]?.trim();
        if (css) blocks.push(css);
    }
    return blocks.join('\n\n');
}

export function backgroundWithMessageCSS(backgroundHTML: string, messageCSS: string): string {
    const css = messageCSS.trim();
    if (!css) return backgroundHTML;
    if (backgroundHTML.includes(css)) return backgroundHTML;
    return `${backgroundHTML.trim()}\n<style>\n${css}\n</style>`.trim();
}
