import { collectTemplateMacros } from './macro';
import { interpretTemplate } from './interpreter';
import { parseTemplate } from './parser';
import type { TemplateContext } from './types';

export async function runTemplate(text: string, ctx: TemplateContext): Promise<string> {
    const macros = await collectTemplateMacros(ctx);
    const parsed = parseTemplate(text);
    return interpretTemplate(parsed, ctx, macros);
}

export { collectTemplateMacros } from './macro';
export { interpretTemplate, parseTemplate };
export type {
    BlockNode,
    Macro,
    MacroFn,
    MacroNode,
    Template,
    TemplateContext,
    TemplateNode,
    TextNode
} from './types';
