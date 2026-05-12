import { collectTemplateMacros } from './macro';
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
        for (const [name, macro] of localMacros) {
            resolved.set(name, macro);
        }
    }
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
