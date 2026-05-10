import type { LLMRole } from '$lib/types/models/llm';

export interface TemplateContext {
    characterId?: string;
    personaId?: string;
    chatId?: string;
    messageId?: string;
    messageIndex?: number;
    role?: LLMRole;
    display?: boolean;
    dryRun?: boolean;
}

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
}

export interface BlockNode {
    type: 'block';
    name: string;
    args: Template[];
    branches: Template[];
}

export type MacroFn = (args: string[], ctx: TemplateContext) => string | Promise<string>;

export interface Macro {
    recursive?: boolean;
    run: MacroFn;
}
