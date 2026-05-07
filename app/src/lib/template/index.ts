import { collectTemplateMacros } from './macro';
import { interpretTemplate } from './interpreter';
import { parseTemplate } from './parser';
import type { Macro, TemplateContext } from './types';

export async function runTemplate(
    text: string,
    ctx: TemplateContext,
    macros?: ReadonlyMap<string, Macro>
): Promise<string> {
    const resolved = macros ?? (await collectTemplateMacros(ctx));
    const parsed = parseTemplate(text);
    return interpretTemplate(parsed, ctx, resolved);
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
