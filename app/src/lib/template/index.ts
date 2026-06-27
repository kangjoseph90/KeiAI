import { collectTemplateMacros, pushLocalMacros } from './macro';
import { interpretTemplate } from './interpreter';
import { parseTemplate } from './parser';
import type { Macro } from './types';
import type { RuntimeContext } from '$lib/types/context';

export async function runTemplate(
    text: string,
    ctx: RuntimeContext,
    localMacros?: ReadonlyMap<string, Macro>
): Promise<string> {
    const resolved = await collectTemplateMacros(ctx);
    if (localMacros) {
        pushLocalMacros(resolved, localMacros);
    }
    const parsed = parseTemplate(text);
    return interpretTemplate(parsed, ctx, resolved);
}

export { collectTemplateMacros, createDryRunMacros, mergeLocalMacros } from './macro';
export { interpretTemplate, parseTemplate };
export type {
    BlockNode,
    Macro,
    MacroFn,
    MacroRegistry,
    MacroNode,
    Template,
    TemplateNode,
    TextNode
} from './types';
