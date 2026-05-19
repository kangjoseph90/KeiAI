import type { BlockNode, Template } from './types';

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

interface ParseFrame {
    name: string;
    args: Template[];
    branches: Template[];
    current: Template;
}

/** Parse template text into a structured Template AST. */
export function parseTemplate(text: string): Template {
    const root: Template = [];
    const stack: ParseFrame[] = [];
    let cursor = 0;

    const current = (): Template => stack.at(-1)?.current ?? root;

    while (cursor < text.length) {
        const tag = findNextTag(text, cursor);

        if (!tag) {
            pushText(current(), text.slice(cursor));
            break;
        }

        pushText(current(), text.slice(cursor, tag.start));

        const parsed = parseTag(tag.inner);

        if (parsed.kind === 'comment') {
            cursor = tag.end;
            continue;
        }

        if (parsed.kind === 'macro') {
            current().push({
                type: 'macro',
                name: normalizeName(parsed.name),
                args: parsed.args.map(parseTemplate),
                raw: tag.raw
            });
            cursor = tag.end;
            continue;
        }

        if (parsed.kind === 'open') {
            const name = normalizeName(parsed.name);

            if (name === 'escape') {
                const raw = readRawBlock(text, tag.end, name);
                if (raw) {
                    current().push({
                        type: 'block',
                        name,
                        args: parsed.args.map(parseTemplate),
                        branches: [[{ type: 'text', value: raw.body }]]
                    });
                    cursor = raw.end;
                    continue;
                }
            }

            stack.push({
                name,
                args: parsed.args.map(parseTemplate),
                branches: [],
                current: []
            });
            cursor = tag.end;
            continue;
        }

        if (parsed.kind === 'branch') {
            const frame = stack.at(-1);
            if (!frame) {
                pushText(current(), tag.raw);
                cursor = tag.end;
                continue;
            }

            frame.branches.push(frame.current);
            frame.current = [];

            if (normalizeName(parsed.name) === 'elif') {
                frame.args.push(...parsed.args.map(parseTemplate));
            }

            cursor = tag.end;
            continue;
        }

        const frame = stack.at(-1);

        if (!frame) {
            pushText(current(), tag.raw);
            cursor = tag.end;
            continue;
        }

        const closeName = normalizeName(parsed.name);
        if (closeName && frame.name !== closeName) {
            pushText(current(), tag.raw);
            cursor = tag.end;
            continue;
        }

        stack.pop();
        frame.branches.push(frame.current);
        current().push(toBlockNode(frame));
        cursor = tag.end;
    }

    while (stack.length > 0) {
        const frame = stack.pop()!;
        frame.branches.push(frame.current);
        current().push(toBlockNode(frame));
    }

    return root;
}

function toBlockNode(frame: ParseFrame): BlockNode {
    return {
        type: 'block',
        name: frame.name,
        args: frame.args,
        branches: frame.branches
    };
}

function pushText(template: Template, value: string): void {
    if (!value) return;

    const last = template.at(-1);
    if (last?.type === 'text') {
        last.value += value;
        return;
    }

    template.push({ type: 'text', value });
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
        const [name, ...args] = splitCall(inner.slice(1).trim());
        return { kind: 'open', name, args };
    }

    if (inner.startsWith('/')) {
        return { kind: 'close', name: inner.slice(1).trim() };
    }

    if (inner.startsWith(':')) {
        const [name, ...args] = splitCall(inner.slice(1).trim());
        return { kind: 'branch', name, args };
    }

    const [name, ...args] = splitCall(inner);
    return { kind: 'macro', name, args };
}

function splitCall(text: string): string[] {
    const separator = findFirstSeparator(text);

    if (separator) {
        return splitBySeparator(text, separator);
    }

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

function readRawBlock(
    text: string,
    from: number,
    name: string
): { body: string; end: number } | null {
    const close = `{{/${name}}}`;
    const index = text.toLowerCase().indexOf(close, from);
    if (index < 0) return null;

    return {
        body: text.slice(from, index),
        end: index + close.length
    };
}

function normalizeName(name: string): string {
    return name.trim().toLowerCase();
}
