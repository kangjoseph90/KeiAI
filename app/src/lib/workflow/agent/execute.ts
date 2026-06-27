import { getAppSettings } from '$lib/stores/content/settings';
import { getMergedLorebooks } from '$lib/stores/content/merged';
import { resolveLLMModelConfig, resolveLLMParameters, selectLLMHandler } from '$lib/llm/handler';
import { AppError } from '$lib/types/errors';
import type { Macro } from '$lib/template';
import type { AgentNode, WorkflowNodeExecutionContext, WorkflowNodeStream } from '../types';
import { buildPrompt } from './prompt';
import { serializeStreamContent } from './llm';

export async function* executeAgentNode({
    node,
    inputs,
    ctx,
    localMacros,
    messages,
    signal
}: WorkflowNodeExecutionContext<AgentNode>): WorkflowNodeStream {
    throwIfAborted(signal);
    if (!ctx?.presetId) {
        throw new AppError('INVALID_INPUT', 'Agent node requires ctx.presetId');
    }
    if (!messages) {
        throw new AppError('INVALID_INPUT', 'Agent node requires paged messages');
    }

    const agentMacros = await buildAgentLocalMacros(node, inputs, localMacros);
    const [settings, modelConfig, parameters, lorebooks] = await Promise.all([
        getAppSettings(),
        resolveLLMModelConfig(node.llmType, ctx.presetId),
        resolveLLMParameters(node.llmType, ctx.presetId),
        shouldResolveLorebooks(node) && ctx.chatId
            ? getMergedLorebooks(ctx.chatId, ctx.characterId)
            : Promise.resolve([])
    ]);

    if (!modelConfig) {
        throw new AppError('INVALID_INPUT', `No model configured for LLM type: ${node.llmType}`);
    }

    const handler = selectLLMHandler(modelConfig, settings);
    if (!handler) {
        throw new AppError('INVALID_INPUT', 'Failed to create LLM handler');
    }

    const prompt = await buildPrompt({
        agent: node,
        lorebooks,
        messages,
        tokenizer: modelConfig.tokenizer ?? 'o200k_base',
        ctx,
        localMacros: agentMacros
    });

    for await (const state of handler.stream(prompt, signal, {
        parameters: parameters ?? {},
        maxResponse: node.maxResponse
    })) {
        throwIfAborted(signal);
        yield { content: serializeStreamContent(state) };
    }
}

async function buildAgentLocalMacros(
    node: AgentNode,
    inputs: WorkflowNodeExecutionContext['inputs'],
    localMacros?: ReadonlyMap<string, Macro>
): Promise<Map<string, Macro>> {
    const slots = new Map<string, string>();

    for (const [inputId, input] of Object.entries(inputs)) {
        const slotName = node.slotNames[inputId];
        if (!slotName) throw new Error(`Agent input slot name not found: ${inputId}`);
        slots.set(slotName, await input.final());
    }

    const macros = new Map<string, Macro>(localMacros);

    macros.set('slot', {
        recursive: true,
        run: (args) => {
            if (args.length !== 1) {
                throw new Error('Agent input slot must be called as {{slot::name}}');
            }
            const [slotName] = args;
            const value = slots.get(slotName);
            if (value !== undefined) return value;
            throw new Error(`Agent input slot not found: ${slotName}`);
        }
    });

    return macros;
}

function shouldResolveLorebooks(node: AgentNode): boolean {
    return Object.values(node.promptBlocks).some(
        (block) => block.enabled && block.type === 'lorebook'
    );
}

function throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) {
        throw new DOMException('Workflow run aborted', 'AbortError');
    }
}
