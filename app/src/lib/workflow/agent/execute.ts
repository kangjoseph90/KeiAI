import { getAppSettings } from '$lib/stores/content/settings';
import { getMergedLorebooks } from '$lib/stores/content/merged';
import { resolveLLMModelConfig, resolveLLMParameters, selectLLMHandler } from '$lib/llm/handler';
import { AppError } from '$lib/types/errors';
import type { Macro } from '$lib/template';
import type {
    AgentNode,
    WorkflowInput,
    WorkflowNodeEvent,
    WorkflowNodeExecutionContext
} from '../types';
import {
    createWorkflowValueEvent,
    requireInput,
    throwIfAborted,
    workflowValueToString
} from '../util';
import { buildPrompt } from './prompt';
import { serializeStreamContent } from './llm';

type AgentMacroResult =
    | { status: 'value'; macros: Map<string, Macro> }
    | { status: 'event'; event: WorkflowNodeEvent };

export async function executeAgentNode({
    node,
    inputs,
    ctx,
    output,
    localMacros,
    messages,
    signal
}: WorkflowNodeExecutionContext<AgentNode>): Promise<void> {
    throwIfAborted(signal);
    if (!ctx?.presetId) {
        throw new AppError('INVALID_INPUT', 'Agent node requires ctx.presetId');
    }
    if (!messages) {
        throw new AppError('INVALID_INPUT', 'Agent node requires paged messages');
    }

    const agentMacrosResult = await buildAgentLocalMacros(node, inputs, localMacros);
    if (agentMacrosResult.status === 'event') {
        output.emit(0, agentMacrosResult.event);
        return;
    }
    const agentMacros = agentMacrosResult.macros;
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

    const shouldStream = await resolveStreamInput(inputs.stream, true);
    let latest = '';

    for await (const state of handler.stream(prompt, signal, {
        parameters: parameters ?? {},
        maxResponse: node.maxResponse
    })) {
        throwIfAborted(signal);
        latest = serializeStreamContent(state);
        if (shouldStream) output.emit(0, createWorkflowValueEvent(latest));
    }

    if (!shouldStream) {
        output.emit(0, createWorkflowValueEvent(latest));
    }
}

async function buildAgentLocalMacros(
    node: AgentNode,
    inputs: Record<string, WorkflowInput>,
    localMacros?: ReadonlyMap<string, Macro>
): Promise<AgentMacroResult> {
    const slots = new Map<string, string>();

    for (const [inputId, input] of Object.entries(inputs)) {
        if (inputId === 'stream') continue;
        const slotName = node.slotNames[inputId];
        if (!slotName) throw new Error(`Agent input slot name not found: ${inputId}`);
        const result = await input.done;
        if (result.status !== 'value') return { status: 'event', event: result };
        slots.set(slotName, workflowValueToString(result.value));
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

    return { status: 'value', macros };
}

async function resolveStreamInput(
    input: WorkflowInput | undefined,
    fallback: boolean
): Promise<boolean> {
    if (!input) return fallback;
    const result = await requireInput(input, 'Agent stream input is required');
    if (result.status !== 'value') return fallback;
    return result.value === true;
}

function shouldResolveLorebooks(node: AgentNode): boolean {
    return Object.values(node.promptBlocks).some(
        (block) => block.enabled && block.type === 'lorebook'
    );
}
