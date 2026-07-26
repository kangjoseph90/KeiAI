import { getAppSettings } from '$lib/stores/content/settings';
import { getMergedLorebooks } from '$lib/stores/content/merged';
import { resolveLLMModelConfig, resolveLLMParameters, selectLLMHandler } from '$lib/llm/handler';
import type { LLMMediaPart, LLMStreamContent, LLMToolRequestPart } from '$lib/llm/types';
import { adaptMediaForCapabilities } from '$lib/llm/capabilities';
import { ToolCallService } from '$lib/services/content/tool';
import type { RuntimeContext } from '$lib/types/context';
import { AppError } from '$lib/types/errors';
import type { ToolCallRequest, ToolCallStatus, ToolDefinition } from '$lib/types/tools';
import { appConfirm } from '$lib/ui';
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
import {
    agentPartsToLLMMessages,
    serializeAgentParts,
    type AgentPart,
    type AgentToolCall
} from './llm';
import { buildPrompt } from './prompt';
import { createChatInlay, getChat } from '$lib/stores';
import { fromBase64 } from '$lib/crypto';
import {
    getToolRuntimeContext,
    resolveAgentTools,
    validateToolArguments,
    type AgentToolDefinition
} from './tool';

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
    let tools = resolveAgentTools(node.toolIds);

    let basePrompt = await buildPrompt({
        agent: node,
        chat,
        lorebooks,
        messages,
        tokenizer: modelConfig.tokenizer ?? 'o200k_base',
        ctx,
        localMacros: agentMacros
    });

    basePrompt = adaptMediaForCapabilities(basePrompt, unsupported);
    if (unsupported.includes('tool_call')) {
        tools = [];
        basePrompt = basePrompt
            .map((message) => ({
                ...message,
                content: message.content.filter(
                    (part) => part.type !== 'tool_request' && part.type !== 'tool_response'
                )
            }))
            .filter((message) => message.content.length > 0);
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
        const promptChat = loop === 0 ? chat : ((await getChat(chat.id)) ?? chat);
        const followupPrompt = [
            ...basePrompt,
            ...(await agentPartsToLLMMessages(completedParts, 'assistant', promptChat))
        ];
        let latestRequestState: LLMStreamContent | null = null;

        for await (const state of handler.stream(followupPrompt, signal, {
            parameters: parameters ?? {},
            maxResponse: node.maxResponse,
            stream: shouldStream,
            tools: toLLMToolDefinitions(tools)
        })) {
            throwIfAborted(signal);
            latestRequestState = state;
            const previewParts = toPreviewParts(state);
            latest = serializeAgentParts([...completedParts, ...previewParts]);
            if (shouldStream) emitIfChanged(latest);
        }

        if (!latestRequestState) break;

        const committedParts = await materializeOutputParts(latestRequestState, chat.id);
        completedParts.push(...committedParts);
        latest = serializeAgentParts(completedParts);
        if (shouldStream) emitIfChanged(latest);

        const toolCalls = latestRequestState.parts.filter(
            (part): part is LLMToolRequestPart => part.type === 'tool_request'
        );
        const pendingToolCalls: Array<{ request: LLMToolRequestPart; recordId: string }> = [];
        const batchCalls: AgentToolCall[] = [];
        for (const toolCall of toolCalls) {
            const created = await ToolCallService.create(
                chat.id,
                { status: 'pending', call: toolCall },
                chat.scopeType
            );
            pendingToolCalls.push({ request: toolCall, recordId: created.id });
            batchCalls.push({
                id: created.id,
                name: toolCall.name,
                status: 'pending'
            });
        }
        const batchIndex =
            batchCalls.length > 0
                ? completedParts.push({ type: 'tool_calls', calls: batchCalls }) - 1
                : -1;
        if (batchIndex >= 0) {
            latest = serializeAgentParts(completedParts);
            emitIfChanged(latest);
        }

        for (const pending of pendingToolCalls) {
            await executeToolCall({
                toolCall: pending.request,
                recordId: pending.recordId,
                batchIndex,
                tools,
                requestApproval: (tool, request) =>
                    confirmToolCall(tool, request, node.name, signal),
                ctx,
                signal,
                completedParts,
                emit: () => {
                    latest = serializeAgentParts(completedParts);
                    emitIfChanged(latest);
                }
            });
        }

        const hasToolCall = toolCalls.length > 0;
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
        recursive: false,
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
    for (const part of state.parts) {
        if (part.type === 'thought' && part.text.trim()) {
            parts.push({ type: 'thought', text: part.text.trim() });
        } else if (part.type === 'text' && part.text) {
            parts.push({ type: 'text', text: part.text });
        }
    }
    return parts;
}

async function materializeOutputParts(
    state: LLMStreamContent,
    chatId: string
): Promise<AgentPart[]> {
    const parts: AgentPart[] = [];

    let pendingInlayIds: string[] = [];
    const flushInlays = (): void => {
        if (pendingInlayIds.length === 0) return;
        parts.push({ type: 'inlay', ids: pendingInlayIds });
        pendingInlayIds = [];
    };

    let mediaIndex = 0;
    for (const part of state.parts) {
        if (part.type === 'thought') {
            flushInlays();
            if (part.text.trim()) parts.push({ type: 'thought', text: part.text.trim() });
            continue;
        }
        if (part.type === 'text') {
            flushInlays();
            if (part.text) parts.push({ type: 'text', text: part.text });
            continue;
        }
        if (part.type === 'tool_request') {
            flushInlays();
            continue;
        }

        const bytes = fromBase64(part.data);
        const extension = getMediaExtension(part);
        const file = new File([bytes], `generated-${++mediaIndex}.${extension}`, {
            type: part.mimeType
        });
        const ref = await createChatInlay(chatId, file);
        pendingInlayIds.push(ref.id);
    }
    flushInlays();
    return parts;
}

function getMediaExtension(part: LLMMediaPart): string {
    const subtype = part.mimeType.split('/')[1]?.split(';')[0]?.trim().toLowerCase();
    if (subtype === 'jpeg') return 'jpg';
    if (subtype === 'x-wav') return 'wav';
    return subtype || part.type;
}

interface ExecuteToolCallInput {
    toolCall: ToolCallRequest;
    recordId: string;
    batchIndex: number;
    tools: AgentToolDefinition[];
    requestApproval: (tool: AgentToolDefinition, toolCall: ToolCallRequest) => Promise<boolean>;
    ctx: RuntimeContext;
    signal: AbortSignal;
    completedParts: AgentPart[];
    emit: () => void;
}

async function executeToolCall(input: ExecuteToolCallInput): Promise<void> {
    const {
        toolCall,
        recordId,
        batchIndex,
        tools,
        requestApproval,
        ctx,
        signal,
        completedParts,
        emit
    } = input;

    const setStatus = (status: ToolCallStatus): void => {
        const batch = completedParts[batchIndex];
        if (batch?.type !== 'tool_calls') {
            throw new AppError('INVALID_INPUT', 'Tool call batch is unavailable');
        }
        completedParts[batchIndex] = {
            type: 'tool_calls',
            calls: batch.calls.map((call) => (call.id === recordId ? { ...call, status } : call))
        };
        emit();
    };

    const tool = tools.find((candidate) => candidate.name === toolCall.name);
    if (!tool) {
        await completeToolError(recordId, `Tool is not enabled for this agent: ${toolCall.name}`);
        setStatus('error');
        return;
    }

    try {
        validateToolArguments(tool, toolCall.args);
        if (tool.permission === 'write') {
            const approved = await requestApproval(tool, toolCall);
            throwIfAborted(signal);
            if (!approved) {
                await ToolCallService.update(recordId, {
                    status: 'rejected',
                    response: [{ type: 'text', text: 'User rejected the tool request.' }]
                });
                setStatus('rejected');
                return;
            }
        }

        await ToolCallService.update(recordId, { status: 'running' });
        setStatus('running');
        const response = await tool.execute(toolCall.args, getToolRuntimeContext(ctx, signal));
        throwIfAborted(signal);
        await ToolCallService.update(recordId, { status: 'success', response });
        setStatus('success');
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Tool execution failed';
        await completeToolError(recordId, message);
        setStatus('error');
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
    }
}

function confirmToolCall(
    tool: AgentToolDefinition,
    toolCall: ToolCallRequest,
    agentName: string,
    signal: AbortSignal
): Promise<boolean> {
    return appConfirm(
        {
            title: `Allow ${tool.label}?`,
            description: formatToolApproval(toolCall, agentName),
            confirmText: 'Allow',
            cancelText: "Don't allow"
        },
        signal
    );
}

async function completeToolError(id: string, message: string): Promise<void> {
    await ToolCallService.update(id, {
        status: 'error',
        response: [{ type: 'text', text: message }]
    });
}

function formatToolApproval(toolCall: ToolCallRequest, agentName: string): string {
    const namespace = typeof toolCall.args.namespace === 'string' ? toolCall.args.namespace : '';
    const path = typeof toolCall.args.path === 'string' ? toolCall.args.path : '';
    const content = typeof toolCall.args.content === 'string' ? toolCall.args.content : '';
    const target = namespace && path ? `${namespace}:${path}` : toolCall.name;
    const action = toolCall.name === 'file_write' ? 'write a file' : 'run this tool';
    const preview = content.length > 500 ? `${content.slice(0, 500)}…` : content;
    const lines = [`${agentName} wants to ${action}`, '', 'Target', target];
    if (preview) lines.push('', 'Content preview', preview);
    return lines.join('\n');
}

function toLLMToolDefinitions(tools: AgentToolDefinition[]): ToolDefinition[] {
    return tools.map((tool) => ({
        id: tool.id,
        name: tool.name,
        description: tool.description,
        permission: tool.permission,
        inputSchema: tool.inputSchema
    }));
}
