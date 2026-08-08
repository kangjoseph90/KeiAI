import DOMPurify from 'dompurify';
import postcss, { type AtRule, type Node as PostcssNode, type Rule } from 'postcss';
import selectorParser, { type Selector } from 'postcss-selector-parser';

type SelectorNode = Selector['nodes'][number];

export function stripStyleTags(css: string): string {
    return css.replace(/<\/?style\b[^>]*>/gi, '');
}

export function scopeCss(css: string, scope: string): string {
    try {
        const root = postcss.parse(css);
        const scopeSelector = selectorParser().astSync(scope).first;
        if (!scopeSelector) return '';

        root.walkRules((rule) => {
            if (hasRuleAncestor(rule) || isInsideKeyframes(rule)) return;

            rule.selector = selectorParser((selectors) => {
                selectors.each((selector) => scopeSelectorNode(selector, scopeSelector));
            }).processSync(rule.selector);
        });

        return root.toString();
    } catch {
        return '';
    }
}

function hasRuleAncestor(rule: Rule): boolean {
    return findAncestor(rule.parent, (node) => node.type === 'rule');
}

function isInsideKeyframes(rule: Rule): boolean {
    return findAncestor(
        rule.parent,
        (node) => node.type === 'atrule' && /(?:^|-)keyframes$/i.test((node as AtRule).name)
    );
}

function findAncestor(
    node: PostcssNode | undefined,
    predicate: (node: PostcssNode) => boolean
): boolean {
    let current = node;
    while (current) {
        if (predicate(current)) return true;
        current = current.parent;
    }
    return false;
}

function scopeSelectorNode(selector: Selector, scopeSelector: Selector): void {
    const first = selector.first;
    if (!first) return;
    first.spaces.before = '';

    selector.prepend(selectorParser.combinator({ value: ' ' }));
    prependNodes(selector, cloneNodes(scopeSelector.nodes));
}

function cloneNodes(nodes: SelectorNode[]): SelectorNode[] {
    return nodes.map((node) => node.clone());
}

function prependNodes(selector: Selector, nodes: SelectorNode[]): void {
    for (const node of nodes.toReversed()) selector.prepend(node);
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
        FORCE_BODY: true,
        ADD_TAGS: ['style'],
        ALLOWED_URI_REGEXP:
            /^(?:(?:https?|mailto|tel|data|blob):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i
    });
}
