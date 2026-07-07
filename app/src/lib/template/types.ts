import type { RuntimeContext } from '$lib/types/context';

export type Template = TemplateNode[];

export type TemplateNode = TextNode | MacroNode | BlockNode;

export interface TextNode {
    type: 'text';
    value: string;
}

export interface MacroNode {
    type: 'macro';
    name: string;
    args: Template[];
    raw?: string;
}

export interface BlockNode {
    type: 'block';
    name: string;
    args: Template[];
    branches: Template[];
}

export type MacroFn = (args: string[], ctx: RuntimeContext) => string | Promise<string>;

export interface Macro {
    recursive?: boolean;
    run: MacroFn;
}

export type MacroRegistry = ReadonlyMap<string, readonly Macro[]>;
