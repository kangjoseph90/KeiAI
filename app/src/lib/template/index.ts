import { collectTemplateMacros, pushLocalMacros } from './macro';
import { interpretTemplate } from './interpreter';
import { parseTemplate } from './parser';
import type { Macro, TemplateContext } from './types';

export async function runTemplate(
    text: string,
    ctx: TemplateContext,
    localMacros?: ReadonlyMap<string, Macro>
): Promise<string> {
    const resolved = await collectTemplateMacros(ctx);
    if (localMacros) {
        pushLocalMacros(resolved, localMacros);
    }
    const parsed = parseTemplate(text);
    return interpretTemplate(parsed, ctx, resolved);
}

export { collectTemplateMacros, createDryRunMacros } from './macro';
export { interpretTemplate, parseTemplate };
export type {
    BlockNode,
    Macro,
    MacroFn,
    MacroRegistry,
    MacroNode,
    Template,
    TemplateContext,
    TemplateNode,
    TextNode
} from './types';
