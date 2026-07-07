import { parseTemplate } from './parser';
import { evaluateExpression, isTruthy, stringifyValue } from './expression';
import { forkMacroRegistry, pushMacro } from './macro';
import type { Macro, MacroRegistry, Template, TemplateNode } from './types';
import type { RuntimeContext } from '$lib/types/context';

const MAX_DEPTH = 20;

export function interpretTemplate(
    template: Template,
    ctx: RuntimeContext,
    macros: MacroRegistry
): Promise<string> {
    return interpret(template, ctx, macros, 0);
}

async function interpret(
    template: Template,
    ctx: RuntimeContext,
    macros: MacroRegistry,
    depth: number
): Promise<string> {
    const chunks: string[] = [];

    for (const node of template) {
        chunks.push(await interpretNode(node, ctx, macros, depth));
    }

    return chunks.join('');
}

function interpretNode(
    node: TemplateNode,
    ctx: RuntimeContext,
    macros: MacroRegistry,
    depth: number
): Promise<string> {
    if (node.type === 'text') return Promise.resolve(node.value);
    if (node.type === 'macro') return interpretMacro(node, ctx, macros, depth);
    return interpretBlock(node, ctx, macros, depth);
}

async function interpretMacro(
    node: Extract<TemplateNode, { type: 'macro' }>,
    ctx: RuntimeContext,
    macros: MacroRegistry,
    depth: number
): Promise<string> {
    if (node.name === '?' || node.name === 'calc') {
        try {
            const value = await evaluateExpression(node.args[0] ?? [], (child) =>
                interpretNode(child, ctx, macros, depth)
            );
            return stringifyValue(value);
        } catch {
            return 'ERROR';
        }
    }

    const args = await Promise.all(node.args.map((arg) => interpret(arg, ctx, macros, depth)));
    const stack = macros.get(node.name);
    if (!stack || stack.length === 0) {
        return node.raw ?? serializeMacro(node.name, args);
    }

    for (let i = stack.length - 1; i >= 0; i -= 1) {
        const macro = stack[i];
        try {
            const value = await macro.run(args, ctx);

            if (!macro.recursive) return value;
            if (depth >= MAX_DEPTH) return 'ERROR: Template depth limit reached';

            return await interpret(parseTemplate(value), ctx, macros, depth + 1);
        } catch {
            continue;
        }
    }

    return 'ERROR';
}

async function interpretBlock(
    node: Extract<TemplateNode, { type: 'block' }>,
    ctx: RuntimeContext,
    macros: MacroRegistry,
    depth: number
): Promise<string> {
    if (node.name === 'pure') {
        return rawBlockText(normalizeBlockBranch(node.branches[0] ?? []));
    }

    if (node.name === 'escape') {
        return escapeBraces(rawBlockText(normalizeBlockBranch(node.branches[0] ?? [])));
    }

    if (node.name === 'if') {
        for (let i = 0; i < node.args.length; i += 1) {
            if (await evaluateTruth(node.args[i], ctx, macros, depth)) {
                return interpret(normalizeBlockBranch(node.branches[i] ?? []), ctx, macros, depth);
            }
        }

        if (node.branches.length > node.args.length) {
            return interpret(
                normalizeBlockBranch(node.branches[node.branches.length - 1] ?? []),
                ctx,
                macros,
                depth
            );
        }

        return '';
    }

    if (node.name === 'each') {
        return interpretEach(node, ctx, macros, depth);
    }

    return interpret(normalizeBlockBranch(node.branches[0] ?? []), ctx, macros, depth);
}

async function interpretEach(
    node: Extract<TemplateNode, { type: 'block' }>,
    ctx: RuntimeContext,
    macros: MacroRegistry,
    depth: number
): Promise<string> {
    try {
        const spec = parseEachSpec(node.args[0] ?? []);
        const items = parseEachItems(await interpret(spec.source, ctx, macros, depth));
        const branch = normalizeBlockBranch(node.branches[0] ?? []);
        const chunks: string[] = [];

        for (const item of items) {
            const scoped = forkMacroRegistry(macros);
            pushMacro(scoped, 'slot', {
                run: ([name]) => {
                    if (name !== spec.name) throw new Error('slot not handled');
                    return stringifySlotValue(item);
                }
            });
            chunks.push(await interpret(branch, ctx, scoped, depth));
        }

        return chunks.join('');
    } catch {
        return 'ERROR';
    }
}

function parseEachSpec(template: Template): { source: Template; name: string } {
    const last = template.at(-1);
    if (last?.type !== 'text') {
        throw new Error('Each block must use "as name"');
    }

    const match = /\s+as\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(last.value);
    if (!match) {
        throw new Error('Each block must use "as name"');
    }

    const source = [...template];
    source[source.length - 1] = {
        type: 'text',
        value: last.value.slice(0, match.index)
    };

    return { source, name: match[1] };
}

function parseEachItems(value: unknown): unknown[] {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string') {
        throw new Error('Each source must be a JSON array');
    }

    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
        throw new Error('Each source must be a JSON array');
    }

    return parsed;
}

function stringifySlotValue(value: unknown): string {
    if (typeof value === 'string') return value;
    if (value === undefined) return '';
    return JSON.stringify(value);
}

async function evaluateTruth(
    expression: Template,
    ctx: RuntimeContext,
    macros: MacroRegistry,
    depth: number
): Promise<boolean> {
    try {
        const value = await evaluateExpression(expression, (node) =>
            interpretNode(node, ctx, macros, depth)
        );
        return isTruthy(value);
    } catch {
        return false;
    }
}

function normalizeBlockBranch(template: Template): Template {
    const next = [...template];
    const first = next[0];
    if (first?.type === 'text') {
        next[0] = { ...first, value: first.value.replace(/^\r?\n/, '') };
    }

    const last = next.at(-1);
    if (last?.type === 'text') {
        next[next.length - 1] = { ...last, value: last.value.replace(/\r?\n$/, '') };
    }

    return next;
}

function rawBlockText(template: Template): string {
    return template
        .map((node) => {
            if (node.type === 'text') return node.value;
            if (node.type === 'macro') return node.raw ?? serializeMacro(node.name, []);
            return '';
        })
        .join('');
}

function escapeBraces(value: string): string {
    return value.replaceAll('{', '\\{').replaceAll('}', '\\}');
}

function serializeMacro(name: string, args: string[]): string {
    if (args.length === 0) return `{{${name}}}`;
    return `{{${name}::${args.join('::')}}}`;
}
