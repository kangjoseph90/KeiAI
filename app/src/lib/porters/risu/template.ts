export function normalizeRisuTemplate(content: string): string {
    return transformTemplate(content, 'normalize');
}

export function denormalizeRisuTemplate(content: string): string {
    return transformTemplate(content, 'denormalize');
}

type Direction = 'normalize' | 'denormalize';
type ParsedTag =
    | { kind: 'macro'; name: string; args: string[] }
    | { kind: 'open'; name: string; args: string[] }
    | { kind: 'close'; name: string }
    | { kind: 'branch'; name: string; args: string[] }
    | { kind: 'comment' };

interface TemplateTag {
    start: number;
    end: number;
    inner: string;
    raw: string;
}

interface BlockFrame {
    source: string;
    target: string;
    close: string;
    slotName?: string;
}

const NORMALIZE_MACRO_NAMES: Readonly<Record<string, string>> = {
    authornote: 'chatnote',
    chatindex: 'messageindex',
    isfirstmsg: 'isfirstmessage',
    lastmessageid: 'lastmessageindex',
    personality: 'characternote',
    scenario: 'characternote',
    exampledialogue: 'characternote',
    mainprompt: 'characternote',
    globalnote: 'characternote'
};

const DENORMALIZE_MACRO_NAMES: Readonly<Record<string, string>> = {
    characternote: 'globalnote',
    charnote: 'globalnote',
    lastmessageindex: 'lastmessageid',
    messageindex: 'chatindex',
    msgindex: 'chatindex'
};

function transformTemplate(content: string, direction: Direction): string {
    const chunks: string[] = [];
    const stack: BlockFrame[] = [];
    let cursor = 0;

    while (cursor < content.length) {
        const tag = findNextTag(content, cursor);
        if (!tag) {
            chunks.push(transformText(content.slice(cursor), direction));
            break;
        }

        chunks.push(transformText(content.slice(cursor, tag.start), direction));
        chunks.push(transformTag(tag, stack, direction));
        cursor = tag.end;
    }

    return chunks.join('');
}

function transformTag(tag: TemplateTag, stack: BlockFrame[], direction: Direction): string {
    const parsed = parseTag(tag.inner);
    if (parsed.kind === 'comment') return tag.raw;

    if (parsed.kind === 'macro') {
        return direction === 'normalize'
            ? normalizeMacro(parsed, tag.raw)
            : denormalizeMacro(parsed, tag.raw);
    }

    if (parsed.kind === 'open') {
        if (direction === 'normalize' && parsed.name === 'when') {
            stack.push({ source: 'when', target: 'if', close: '{{/if}}' });
            return `{{#if ${risuWhenToExpression(parsed.args, activeSlotNames(stack))}}}`;
        }

        if (direction === 'normalize' && parsed.name === 'each') {
            const spec = risuEachToKeiSpec(parsed.args);
            stack.push({ source: 'each', target: 'each', close: '{{/each}}', slotName: spec.name });
            return `{{#each ${spec.text}}}`;
        }

        if (direction === 'normalize' && parsed.name === 'puredisplay') {
            stack.push({ source: 'puredisplay', target: 'pure', close: '{{/pure}}' });
            return '{{#pure}}';
        }

        if (direction === 'normalize' && parsed.name === 'if_pure') {
            stack.push({ source: 'if_pure', target: 'if', close: '{{/pure}}{{/if}}' });
            return `{{#if ${risuWhenToExpression(parsed.args, activeSlotNames(stack))}}}{{#pure}}`;
        }

        stack.push({ source: parsed.name, target: parsed.name, close: `{{/${parsed.name}}}` });
        return tag.raw;
    }

    if (parsed.kind === 'close') {
        const frame = popCloseFrame(stack, parsed.name);
        if (!frame) return tag.raw;
        return frame.close;
    }

    if (parsed.kind === 'branch') {
        const frame = stack.at(-1);
        if (direction === 'normalize' && frame?.source === 'if_pure') {
            if (parsed.name === 'elif') {
                return `{{/pure}}{{:elif ${risuWhenToExpression(parsed.args, activeSlotNames(stack))}}}{{#pure}}`;
            }

            return `{{/pure}}${tag.raw}{{#pure}}`;
        }

        return tag.raw;
    }

    return tag.raw;
}

function transformText(text: string, direction: Direction): string {
    if (direction === 'denormalize') return text;
    return text.replace(/<(user|bot|char)>/gi, (_match, name: string) =>
        normalizeName(name) === 'user' ? '{{user}}' : '{{char}}'
    );
}

function normalizeMacro(parsed: Extract<ParsedTag, { kind: 'macro' }>, raw: string): string {
    const normalizedName = NORMALIZE_MACRO_NAMES[parsed.name];
    if (normalizedName) return renderMacro(normalizedName, parsed.args);

    if (parsed.name === 'getglobalvar' && parsed.args.length === 1) {
        const key = parsed.args[0] ?? '';
        if (key.startsWith('toggle_')) return `{{gettoggle::${key.slice('toggle_'.length)}}}`;
    }

    return raw;
}

function denormalizeMacro(parsed: Extract<ParsedTag, { kind: 'macro' }>, raw: string): string {
    const denormalizedName = DENORMALIZE_MACRO_NAMES[parsed.name];
    if (denormalizedName) return renderMacro(denormalizedName, parsed.args);

    if (parsed.name === 'gettoggle' && parsed.args.length === 1) {
        return `{{getglobalvar::toggle_${parsed.args[0] ?? ''}}}`;
    }

    return raw;
}

function renderMacro(name: string, args: string[]): string {
    return args.length > 0 ? `{{${name}::${args.join('::')}}}` : `{{${name}}}`;
}

function popCloseFrame(stack: BlockFrame[], name: string): BlockFrame | null {
    if (stack.length === 0) return null;

    if (!name) return stack.pop() ?? null;

    const normalized = normalizeName(name);
    const frame = stack.at(-1);
    if (frame && frame.source === normalized) return stack.pop() ?? null;
    if (frame && frame.target === normalized) return stack.pop() ?? null;
    if (normalized === 'when' && frame?.source === 'when') return stack.pop() ?? null;

    return null;
}

function activeSlotNames(stack: BlockFrame[]): ReadonlySet<string> {
    return new Set(stack.map((frame) => frame.slotName).filter((name) => name !== undefined));
}

function risuWhenToExpression(args: string[], slotNames: ReadonlySet<string>): string {
    const tokens = expandControlMarkers(args).filter((arg) => arg !== 'keep' && arg !== 'legacy');
    if (tokens.length === 0) return 'false';
    return buildWhenExpression(tokens, slotNames);
}

function buildWhenExpression(tokens: string[], slotNames: ReadonlySet<string>): string {
    if (tokens.length === 1) return valueForTruthy(tokens[0] ?? '', slotNames);

    const first = normalizeName(tokens[0] ?? '');
    if (first === 'not') {
        const rest = tokens.slice(1);
        const inner =
            rest.length > 1
                ? wrapIfNeeded(buildWhenExpression(rest, slotNames))
                : valueForTruthy(rest[0] ?? '', slotNames);
        return `not ${inner}`;
    }
    if (first === 'var') return `{{getvar::${tokens[1] ?? ''}}}`;
    if (first === 'toggle') return `{{gettoggle::${tokens[1] ?? ''}}}`;

    const left = tokens[0] ?? '';
    const op = normalizeName(tokens[1] ?? '');
    const rightTokens = tokens.slice(2);
    const right =
        rightTokens.length > 1
            ? buildWhenExpression(rightTokens, slotNames)
            : (rightTokens[0] ?? '');

    if (op === 'and')
        return `${wrapIfNeeded(valueForTruthy(left, slotNames))} and ${wrapIfNeeded(rightOperand(right, slotNames))}`;
    if (op === 'or')
        return `${wrapIfNeeded(valueForTruthy(left, slotNames))} or ${wrapIfNeeded(rightOperand(right, slotNames))}`;
    if (op === 'is')
        return `${valueForComparison(left, slotNames)} == ${valueForComparison(right, slotNames)}`;
    if (op === 'isnot')
        return `${valueForComparison(left, slotNames)} != ${valueForComparison(right, slotNames)}`;
    if (op === '>' || op === '<' || op === '>=' || op === '<=') {
        return `${valueForNumericComparison(left, slotNames)} ${op} ${valueForNumericComparison(right, slotNames)}`;
    }
    if (op === 'vis') return `{{getvar::${left}}} == ${valueForComparison(right, slotNames)}`;
    if (op === 'visnot') return `{{getvar::${left}}} != ${valueForComparison(right, slotNames)}`;
    if (op === 'tis') return `{{gettoggle::${left}}} == ${valueForComparison(right, slotNames)}`;
    if (op === 'tisnot') return `{{gettoggle::${left}}} != ${valueForComparison(right, slotNames)}`;

    return valueForTruthy(right, slotNames);
}

function rightOperand(value: string, slotNames: ReadonlySet<string>): string {
    return isExpressionLike(value) ? value : valueForTruthy(value, slotNames);
}

function valueForTruthy(value: string, slotNames: ReadonlySet<string>): string {
    const trimmed = value.trim();
    if (slotNames.has(trimmed)) return `{{slot::${trimmed}}}`;
    if (isTemplateExpression(trimmed)) return normalizeRisuTemplate(trimmed);
    if (isExpressionLike(trimmed) || isBooleanLiteral(trimmed)) return trimmed;
    if (isNumberLiteral(trimmed)) return trimmed;
    return JSON.stringify(trimmed);
}

function valueForComparison(value: string, slotNames: ReadonlySet<string>): string {
    const trimmed = value.trim();
    if (slotNames.has(trimmed)) return `{{slot::${trimmed}}}`;
    if (isTemplateExpression(trimmed)) return normalizeRisuTemplate(trimmed);
    if (isGeneratedExpression(trimmed)) return trimmed;
    if (isNumberLiteral(trimmed) || isBooleanLiteral(trimmed)) return trimmed;
    return JSON.stringify(trimmed);
}

function valueForNumericComparison(value: string, slotNames: ReadonlySet<string>): string {
    const trimmed = value.trim();
    if (slotNames.has(trimmed)) return `{{slot::${trimmed}}}`;
    if (isTemplateExpression(trimmed)) return normalizeRisuTemplate(trimmed);
    if (isGeneratedExpression(trimmed) || isNumberLiteral(trimmed)) return trimmed;
    return JSON.stringify(trimmed);
}

function risuEachToKeiSpec(args: string[]): { text: string; name: string } {
    const tokens = expandControlMarkers(args).filter((arg) => arg !== 'keep');
    const text = tokens.join(' ').trim();
    if (!text) return { text: '[] as item', name: 'item' };

    const asMatch = /^(.*?)\s+as\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(text);
    if (asMatch) {
        const source = normalizeEachSource(asMatch[1] ?? '');
        const name = asMatch[2] ?? 'item';
        return { text: `${source} as ${name}`, name };
    }

    const trailing = splitTrailingIdentifier(text);
    if (trailing && trailing.source) {
        return {
            text: `${normalizeEachSource(trailing.source)} as ${trailing.name}`,
            name: trailing.name
        };
    }

    const name = isIdentifier(text) ? text : 'item';
    return { text: `${normalizeEachSource(text)} as ${name}`, name };
}

function normalizeEachSource(source: string): string {
    const trimmed = source.trim();
    if (isIdentifier(trimmed)) return `{{getvar::${trimmed}}}`;
    return trimmed;
}

function splitTrailingIdentifier(text: string): { source: string; name: string } | null {
    const match = /^(.*\S)\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(text);
    if (!match) return null;
    return { source: match[1] ?? '', name: match[2] ?? 'item' };
}

function expandControlMarkers(args: string[]): string[] {
    const result: string[] = [];

    for (const arg of args) {
        const match = /^(keep|legacy)\s+(.+)$/i.exec(arg);
        if (match) {
            result.push(normalizeName(match[1] ?? ''), match[2] ?? '');
            continue;
        }

        result.push(arg);
    }

    return result;
}

function isTemplateExpression(value: string): boolean {
    return value.startsWith('{{') && value.endsWith('}}');
}

function isGeneratedExpression(value: string): boolean {
    return value.startsWith('(') && value.endsWith(')');
}

function isExpressionLike(value: string): boolean {
    return isGeneratedExpression(value) || /\s(?:and|or)\s/.test(value);
}

function isNumberLiteral(value: string): boolean {
    return /^-?\d+(?:\.\d+)?$/.test(value);
}

function isBooleanLiteral(value: string): boolean {
    const normalized = value.toLowerCase();
    return normalized === 'true' || normalized === 'false';
}

function isIdentifier(value: string): boolean {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function wrapIfNeeded(value: string): string {
    return /\s/.test(value) && !isGeneratedExpression(value) ? `(${value})` : value;
}

function findNextTag(text: string, from: number): TemplateTag | null {
    const start = text.indexOf('{{', from);
    if (start < 0) return null;

    let cursor = start + 2;
    let depth = 1;

    while (cursor < text.length) {
        const nextOpen = text.indexOf('{{', cursor);
        const nextClose = text.indexOf('}}', cursor);

        if (nextClose < 0) return null;

        if (nextOpen >= 0 && nextOpen < nextClose) {
            depth += 1;
            cursor = nextOpen + 2;
            continue;
        }

        depth -= 1;
        cursor = nextClose + 2;

        if (depth === 0) {
            return {
                start,
                end: cursor,
                inner: text.slice(start + 2, nextClose).trim(),
                raw: text.slice(start, cursor)
            };
        }
    }

    return null;
}

function parseTag(inner: string): ParsedTag {
    if (inner.startsWith('//')) return { kind: 'comment' };

    if (inner.startsWith('#')) {
        const [name = '', ...args] = splitCall(inner.slice(1).trim());
        return { kind: 'open', name: normalizeName(name), args };
    }

    if (inner.startsWith('/')) {
        return { kind: 'close', name: normalizeName(inner.slice(1).trim()) };
    }

    if (inner.startsWith(':')) {
        const [name = '', ...args] = splitCall(inner.slice(1).trim());
        return { kind: 'branch', name: normalizeName(name), args };
    }

    const [name = '', ...args] = splitCall(inner);
    return { kind: 'macro', name: normalizeName(name), args };
}

function splitCall(text: string): string[] {
    const separator = findFirstSeparator(text);
    if (separator) return splitBySeparator(text, separator);

    const whitespace = findFirstWhitespace(text);
    if (whitespace >= 0) {
        const name = text.slice(0, whitespace).trim();
        const arg = text.slice(whitespace).trim();
        return arg ? [name, arg] : [name];
    }

    return [text.trim()];
}

function findFirstSeparator(text: string): ':' | '::' | null {
    let depth = 0;

    for (let i = 0; i < text.length; i += 1) {
        if (text.startsWith('{{', i)) {
            depth += 1;
            i += 1;
            continue;
        }

        if (text.startsWith('}}', i)) {
            depth = Math.max(0, depth - 1);
            i += 1;
            continue;
        }

        if (depth === 0 && text.startsWith('::', i)) return '::';
    }

    depth = 0;
    for (let i = 0; i < text.length; i += 1) {
        if (text.startsWith('{{', i)) {
            depth += 1;
            i += 1;
            continue;
        }

        if (text.startsWith('}}', i)) {
            depth = Math.max(0, depth - 1);
            i += 1;
            continue;
        }

        if (depth === 0 && text[i] === ':') return ':';
    }

    return null;
}

function splitBySeparator(text: string, separator: ':' | '::'): string[] {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;

    for (let i = 0; i < text.length; i += 1) {
        if (text.startsWith('{{', i)) {
            depth += 1;
            i += 1;
            continue;
        }

        if (text.startsWith('}}', i)) {
            depth = Math.max(0, depth - 1);
            i += 1;
            continue;
        }

        if (depth === 0 && text.startsWith(separator, i)) {
            parts.push(text.slice(start, i).trim());
            i += separator.length - 1;
            start = i + 1;
        }
    }

    parts.push(text.slice(start).trim());
    return parts;
}

function findFirstWhitespace(text: string): number {
    let depth = 0;

    for (let i = 0; i < text.length; i += 1) {
        if (text.startsWith('{{', i)) {
            depth += 1;
            i += 1;
            continue;
        }

        if (text.startsWith('}}', i)) {
            depth = Math.max(0, depth - 1);
            i += 1;
            continue;
        }

        if (depth === 0 && /\s/.test(text[i])) return i;
    }

    return -1;
}

function normalizeName(name: string): string {
    return name.trim().toLowerCase();
}
