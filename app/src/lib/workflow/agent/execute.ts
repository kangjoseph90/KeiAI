import { getAppSettings } from '$lib/stores/content/settings';
import { getMergedLorebooks } from '$lib/stores/content/merged';
import { resolveLLMModelConfig, resolveLLMParameters, selectLLMHandler } from '$lib/llm/handler';
import type { LLMContentPart, LLMStreamContent } from '$lib/llm/types';
import { ToolCallService, type ToolCallRequest } from '$lib/services/content/tool';
import type { RuntimeContext } from '$lib/types/context';
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
import { agentPartsToLLMMessages, serializeAgentParts, type AgentPart } from './llm';
import { buildPrompt } from './prompt';
import { getChat } from '$lib/stores';

type AgentMacroResult =
    | { status: 'value'; macros: Map<string, Macro> }
    | { status: 'event'; event: WorkflowNodeEvent };

const MAX_AGENT_TOOL_CALL_LOOPS = 8;

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
    if (!ctx?.chatId) {
        throw new AppError('INVALID_INPUT', 'Agent node requires ctx.chatId');
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
    const [settings, chat, modelConfig, parameters, lorebooks] = await Promise.all([
        getAppSettings(),
        getChat(ctx.chatId),
        resolveLLMModelConfig(node.llmType, ctx.presetId),
        resolveLLMParameters(node.llmType, ctx.presetId),
        shouldResolveLorebooks(node) && ctx.chatId
            ? getMergedLorebooks(ctx.chatId, ctx.characterId)
            : Promise.resolve([])
    ]);

    if (!chat) {
        throw new AppError('NOT_FOUND', `Chat not found: ${ctx.chatId}`);
    }

    if (!modelConfig) {
        throw new AppError('INVALID_INPUT', `No model configured for LLM type: ${node.llmType}`);
    }

    const selected = selectLLMHandler(modelConfig, settings);
    if (!selected) {
        throw new AppError('INVALID_INPUT', 'Failed to create LLM handler');
    }
    const { handler, unsupported = [] } = selected;

    let basePrompt = await buildPrompt({
        agent: node,
        chat,
        lorebooks,
        messages,
        tokenizer: modelConfig.tokenizer ?? 'o200k_base',
        ctx,
        localMacros: agentMacros
    });

    // TODO: Share capability adaptation with CharJS and plugin LLM calls when more capabilities are added.
    if (unsupported.includes('image_input')) {
        basePrompt = basePrompt.map((message) => ({
            ...message,
            content: message.content.map(
                (part): LLMContentPart =>
                    part.type === 'image' ? { type: 'text', text: '[Image omitted]' } : part
            )
        }));
    }

    const shouldStream =
        (await resolveStreamInput(inputs.stream, true)) && !unsupported.includes('streaming');
    const completedParts: AgentPart[] = [];
    let latest = serializeAgentParts(completedParts);
    let lastEmitted: string | null = null;

    const emitIfChanged = (value: string): void => {
        if (value === lastEmitted) return;
        output.emit(0, createWorkflowValueEvent(value));
        lastEmitted = value;
    };

    for (let loop = 0; loop < MAX_AGENT_TOOL_CALL_LOOPS; loop += 1) {
        throwIfAborted(signal);
        const followupPrompt = [...basePrompt, ...agentPartsToLLMMessages(completedParts)];
        let latestRequestState: LLMStreamContent | null = null;

        for await (const state of handler.stream(followupPrompt, signal, {
            parameters: parameters ?? {},
            maxResponse: node.maxResponse,
            stream: shouldStream
        })) {
            throwIfAborted(signal);
            latestRequestState = state;
            const previewParts = toPreviewParts(state);
            latest = serializeAgentParts([...completedParts, ...previewParts]);
            if (shouldStream) emitIfChanged(latest);
        }

        if (!latestRequestState) break;

        const committedParts = await toCommittedParts(latestRequestState, ctx);
        throwIfAborted(signal);

        completedParts.push(...committedParts);
        latest = serializeAgentParts(completedParts);
        if (shouldStream) emitIfChanged(latest);

        const hasToolCall = committedParts.some((part) => part.type === 'tool_call');
        if (!hasToolCall) break;
    }

    if (!shouldStream) {
        emitIfChanged(latest);
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

function toPreviewParts(state: LLMStreamContent): AgentPart[] {
    const parts: AgentPart[] = [];
    if (state.thought?.trim()) {
        parts.push({ type: 'thought', text: state.thought.trim() });
    }
    if (state.content) {
        parts.push({ type: 'content', text: state.content });
    }
    return parts;
}

async function toCommittedParts(
    state: LLMStreamContent,
    ctx: RuntimeContext
): Promise<AgentPart[]> {
    const parts = toPreviewParts(state);
    for (const toolCall of state.toolCalls ?? []) {
        parts.push(await createToolCallPart(toolCall, ctx));
    }
    return parts;
}

async function createToolCallPart(
    toolCall: ToolCallRequest,
    ctx: RuntimeContext
): Promise<AgentPart> {
    if (!ctx.chatId) {
        throw new Error('Tool call creation requires chatId');
    }

    const created = await ToolCallService.create(ctx.chatId, {
        status: 'pending',
        call: toolCall
    });

    // TODO: Replace this mock response with real tool execution/approval handling.
    const completed = await ToolCallService.update(created.id, {
        status: 'success',
        response: {
            content: [
                {
                    type: 'text',
                    text: `Mock tool response for ${toolCall.name}`
                }
            ]
        }
    });

    return {
        type: 'tool_call',
        id: completed.id,
        name: completed.call.name,
        status: completed.status
    };
}
