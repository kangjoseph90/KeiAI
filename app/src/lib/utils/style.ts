import DOMPurify from 'dompurify';

export function stripStyleTags(css: string): string {
    return css.replace(/<\/?style\b[^>]*>/gi, '');
}

export function scopeCss(css: string, scope: string): string {
    const keyframes: string[] = [];
    const protectedCss = css.replace(
        /@(?:-[a-z]+-)?keyframes\b[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/gi,
        (block) => `__KEI_KEYFRAMES_${keyframes.push(block) - 1}__`
    );
    const scoped = protectedCss.replace(
        /(^|[{}])\s*([^@{}][^{}]*)\{/g,
        (_match: string, prefix: string, selectors: string) => {
            const next = selectors
                .split(',')
                .map((selector: string) => selector.trim())
                .filter(Boolean)
                .map((selector: string) => `${scope} ${selector}`)
                .join(', ');
            return `${prefix}${next} {`;
        }
    );
    return scoped.replace(/__KEI_KEYFRAMES_(\d+)__/g, (_, index: string) => {
        return keyframes[Number(index)] ?? '';
    });
}

export function scopeStyleBlocks(html: string, scope: string): string {
    return html.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (_match, attrs, css) => {
        return `<style${attrs}>${scopeCss(stripStyleTags(css), scope)}</style>`;
    });
}

const STYLE_BLOCK_REGEX = /<style\b[^>]*>[\s\S]*?<\/style>/gi;

export function protectHtmlStyles(
    value: string,
    prefix = 'kei-style'
): { text: string; styles: string[] } {
    const styles: string[] = [];
    const text = value.replace(STYLE_BLOCK_REGEX, (style) => {
        const index = styles.push(style) - 1;
        return `\n<!--${prefix}-${index}-->\n`;
    });
    return { text, styles };
}

export function restoreHtmlStyles(value: string, styles: string[], prefix = 'kei-style'): string {
    const regex = new RegExp(`<!--${prefix}-(\\d+)-->`, 'g');
    return value.replace(regex, (_, index: string) => {
        return styles[Number(index)] ?? '';
    });
}

export function sanitizeWithStyle(html: string): string {
    return DOMPurify.sanitize(html, {
        ADD_TAGS: ['style'],
        ALLOWED_URI_REGEXP:
            /^(?:(?:https?|mailto|tel|data|blob):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i
    });
}
