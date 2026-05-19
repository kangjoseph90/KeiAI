import { parseTemplate } from './parser';
import type { Macro, Template, TemplateContext, TemplateNode } from './types';

const MAX_DEPTH = 20;

export function interpretTemplate(
    template: Template,
    ctx: TemplateContext,
    macros: ReadonlyMap<string, Macro>
): Promise<string> {
    return interpret(template, ctx, macros, 0);
}

async function interpret(
    template: Template,
    ctx: TemplateContext,
    macros: ReadonlyMap<string, Macro>,
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
    ctx: TemplateContext,
    macros: ReadonlyMap<string, Macro>,
    depth: number
): Promise<string> {
    if (node.type === 'text') return Promise.resolve(node.value);
    if (node.type === 'macro') return interpretMacro(node, ctx, macros, depth);
    return interpretBlock(node, ctx, macros, depth);
}

async function interpretMacro(
    node: Extract<TemplateNode, { type: 'macro' }>,
    ctx: TemplateContext,
    macros: ReadonlyMap<string, Macro>,
    depth: number
): Promise<string> {
    const macro = macros.get(node.name);
    const args = await Promise.all(node.args.map((arg) => interpret(arg, ctx, macros, depth)));

    if (!macro) {
        return node.raw ?? serializeMacro(node.name, args);
    }

    const value = await macro.run(args, ctx);

    if (!macro.recursive) return value;
    if (depth >= MAX_DEPTH) return 'ERROR: Template depth limit reached';

    return interpret(parseTemplate(value), ctx, macros, depth + 1);
}

async function interpretBlock(
    node: Extract<TemplateNode, { type: 'block' }>,
    ctx: TemplateContext,
    macros: ReadonlyMap<string, Macro>,
    depth: number
): Promise<string> {
    if (node.name === 'escape') {
        return interpret(node.branches[0] ?? [], ctx, macros, depth);
    }

    if (node.name === 'if') {
        for (let i = 0; i < node.args.length; i += 1) {
            const value = await interpret(node.args[i], ctx, macros, depth);
            if (isTruthy(value)) {
                return interpret(node.branches[i] ?? [], ctx, macros, depth);
            }
        }

        if (node.branches.length > node.args.length) {
            return interpret(node.branches[node.branches.length - 1] ?? [], ctx, macros, depth);
        }

        return '';
    }

    return interpret(node.branches[0] ?? [], ctx, macros, depth);
}

function isTruthy(value: string): boolean {
    const normalized = value.trim().toLowerCase();
    return (
        normalized !== '' && normalized !== '0' && normalized !== 'false' && normalized !== 'null'
    );
}

function serializeMacro(name: string, args: string[]): string {
    if (args.length === 0) return `{{${name}}}`;
    return `{{${name}::${args.join('::')}}}`;
}
