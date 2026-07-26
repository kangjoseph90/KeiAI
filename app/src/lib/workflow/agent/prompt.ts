/**
 * Prompt Builder — KeiAI
 *
 * Assembles OpenAI-compatible messages from preset prompt blocks.
 * History is loaded lazily through PagedMessages when a history block needs it.
 */

import type { PagedMessages } from '$lib/services/content/paged_messages';
import type { Character, Chat, Persona, Lorebook } from '$lib/services';
import { getTextContent, type LLMContentPart, type LLMMessage } from '../../llm/types';
import type { LLMRole, LLMTokenizer } from '$lib/types/models/llm';
import { runPipeline } from '$lib/pipeline';
import { runTemplate, createDryRunMacros, mergeLocalMacros } from '$lib/template';
import type { Macro } from '$lib/template';
import { TokenCounter } from '$lib/llm/tokenizer';
import { AppError } from '$lib/types/errors';
import type { Message } from '$lib/services/content/message';
import { resolveLorebookEntries } from './lorebook';
import { getLastContentText } from './llm';
import { ToolCallService } from '$lib/services/content/tool';
import { resolveAgentTools } from './tool';
import { toMessageContext, toRoleContext } from './context';
import { compareSortOrder } from '$lib/utils/ordering';
import type { RuntimeContext } from '$lib/types/context';
import type { PromptBlock } from '../types';
import { AssetService } from '$lib/services/asset';
import { toBase64 } from '$lib/crypto';
import { getAssetMediaType } from '$lib/types/asset';

// ─── Input ────────────────────────────────────────────────────────────────────

export interface PromptInput {
    chat: Chat;
    agent: AgentPromptConfig;
    lorebooks: Lorebook[];
    messages: PagedMessages;
    tokenizer: LLMTokenizer;
    ctx: RuntimeContext;
    localMacros?: ReadonlyMap<string, Macro>;
}

export interface AgentPromptConfig {
    toolIds: string[];
    promptBlocks: Record<string, PromptBlock>;
    maxContext: number;
    maxResponse: number;
    lorebookRatio: number;
    memoryRatio: number;
    lorebookScanDepth: number;
}

type PromptBlockResult = {
    messages: LLMMessage[];
    tokens: number;
};

type PromptBudget = {
    input: number;
    used: number;
    lorebookCap: number;
    memoryCap: number;
};

type LorebookPromptBlock = Extract<PromptBlock, { type: 'lorebook' }>;
type LorebookBucketEntry = {
    order: number;
    message: LLMMessage;
};

// ─── Builder ──────────────────────────────────────────────────────────────────

export async function buildPrompt(input: PromptInput): Promise<LLMMessage[]> {
    const blocks = getEnabledPromptBlocks(input.agent.promptBlocks);

    const budget = createPromptBudget(input.agent);
    budget.used += await countToolDefinitions(input.agent.toolIds, input.tokenizer);
    if (budget.used > budget.input) {
        throw new AppError('INVALID_INPUT', 'Tool definitions exceed the prompt input budget');
    }
    const result = new Map<string, PromptBlockResult>();
    const unboundedHistoryBlocks = blocks.filter(isUnboundedHistoryBlock);

    if (unboundedHistoryBlocks.length > 1) {
        throw new AppError('INVALID_INPUT', 'Prompt can only have one unbounded history block');
    }

    for (const block of blocks.filter(isFixedBlock)) {
        const res = await buildFixedBlock(block, input);

        if (budget.used + res.tokens > budget.input) {
            throw new AppError(
                'INVALID_INPUT',
                `Prompt budget exceeded while processing fixed block: ${block.name}`
            );
        }

        result.set(block.id, res);
        budget.used += res.tokens;
    }

    const lorebookBlocks = blocks.filter(isLorebookBlock);
    if (lorebookBlocks.length > 0) {
        const blockBudget = getLorebookBudget(budget);
        const lorebookResults = await buildLorebookBlocks(lorebookBlocks, input, blockBudget);
        const tokens = sumBlockTokens(lorebookResults);

        if (tokens > blockBudget) {
            throw new AppError(
                'INVALID_INPUT',
                'Prompt budget exceeded while processing lorebooks'
            );
        }

        for (const [blockId, res] of lorebookResults) {
            result.set(blockId, res);
        }
        budget.used += tokens;
    }

    for (const block of unboundedHistoryBlocks) {
        const remainingBudget = Math.max(0, budget.input - budget.used);
        const res = await buildUnboundedHistoryBlock(block, input, remainingBudget);

        result.set(block.id, res);
        budget.used += res.tokens;
    }

    return flattenBlocks(blocks, result);
}

// ─── Block Builders ─────────────────────────────────────────────────────────

async function buildFixedBlock(block: PromptBlock, input: PromptInput): Promise<PromptBlockResult> {
    let messages: LLMMessage[] = [];
    const templateMacros = mergeLocalMacros(input.localMacros, createDryRunMacros());

    switch (block.type) {
        case 'text':
            messages = makeMessage(
                block.role,
                await runTemplate(
                    block.content,
                    toRoleContext(input.ctx, block.role),
                    templateMacros
                )
            );
            break;

        case 'history': {
            const start = await resolveHistoryIndex(
                block.start,
                input.ctx,
                templateMacros,
                'start',
                block.name
            );
            const end = await resolveHistoryIndex(
                block.end,
                input.ctx,
                templateMacros,
                'end',
                block.name
            );
            const slice = await input.messages.slice(start, end);
            for (const { message, index } of slice) {
                const rendered = await renderHistoryMessage(
                    message,
                    index,
                    input.ctx,
                    input.chat,
                    block.historyMode,
                    block.format,
                    input.localMacros
                );
                messages.push(...rendered);
            }
            break;
        }
    }

    const tokens = await countMessages(messages, input.tokenizer);
    return { messages, tokens };
}

async function buildLorebookBlocks(
    blocks: LorebookPromptBlock[],
    input: PromptInput,
    budget: number
): Promise<Map<string, PromptBlockResult>> {
    const result = new Map<string, PromptBlockResult>(
        blocks.map((block) => [block.id, { messages: [], tokens: 0 }])
    );
    const buckets = new Map<string, LorebookBucketEntry[]>(blocks.map((block) => [block.id, []]));
    if (budget <= 0) return result;

    validateLorebookBlockRanges(blocks);

    const activeLorebooks = await resolveLorebookEntries({
        lorebooks: input.lorebooks,
        messages: input.messages,
        defaultScanDepth: input.agent.lorebookScanDepth,
        ctx: input.ctx,
        localMacros: input.localMacros
    });

    let used = 0;

    for (const lorebook of [...activeLorebooks].sort((a, b) => b.order - a.order)) {
        const block = blocks.find((candidate) => isDepthInRange(lorebook.depth, candidate));
        if (!block) continue;

        const templateMacros = mergeLocalMacros(input.localMacros, createDryRunMacros());
        const content = await renderWithFormat(
            lorebook.content,
            block.format,
            toRoleContext(input.ctx, lorebook.role),
            undefined,
            templateMacros
        );
        const messages = makeMessage(lorebook.role, content);
        const tokens = await countMessages(messages, input.tokenizer);
        if (messages.length === 0 || tokens === 0) continue;
        if (used + tokens > budget) continue;

        const bucket = result.get(block.id);
        const bucketEntries = buckets.get(block.id);
        if (!bucket || !bucketEntries) continue;

        bucketEntries.push(...messages.map((message) => ({ order: lorebook.order, message })));
        bucket.tokens += tokens;
        used += tokens;
    }

    for (const block of blocks) {
        const bucket = result.get(block.id);
        const bucketEntries = buckets.get(block.id);
        if (!bucket || !bucketEntries) continue;
        const direction = block.reverseOrder ? 1 : -1;
        bucket.messages = bucketEntries
            .map((entry, index) => ({ ...entry, index }))
            .sort((a, b) => {
                if (a.order === b.order) return a.index - b.index;
                return (a.order - b.order) * direction;
            })
            .map(({ message }) => message);
    }

    return result;
}

async function buildUnboundedHistoryBlock(
    block: PromptBlock,
    input: PromptInput,
    remainingBudget: number
): Promise<PromptBlockResult> {
    if (block.type !== 'history') return { messages: [], tokens: 0 };

    const messages: LLMMessage[] = [];
    let remaining = Math.max(0, remainingBudget);
    let sawRenderableMessage = false;

    for (let index = input.messages.length - 1; index >= 0; index -= 1) {
        const indexed = await input.messages.at(index);
        if (!indexed) continue;

        const rendered = await renderHistoryMessage(
            indexed.message,
            indexed.index,
            input.ctx,
            input.chat,
            block.historyMode,
            block.format,
            input.localMacros
        );
        if (rendered.length === 0) continue;

        sawRenderableMessage = true;
        const tokens = await countMessages(rendered, input.tokenizer);
        if (tokens > remaining) {
            if (messages.length === 0) {
                throw new AppError(
                    'INVALID_INPUT',
                    `Latest history message does not fit in prompt budget: ${block.name}`
                );
            }
            break;
        }

        messages.unshift(...rendered);
        remaining -= tokens;
    }

    if (sawRenderableMessage && messages.length === 0) {
        throw new AppError(
            'INVALID_INPUT',
            `Latest history message does not fit in prompt budget: ${block.name}`
        );
    }

    const totalTokens = await countMessages(messages, input.tokenizer);
    return { messages, tokens: totalTokens };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getEnabledPromptBlocks(blocks: Record<string, PromptBlock>): PromptBlock[] {
    return Object.values(blocks).filter((block) => block.enabled);
}

function flattenBlocks(
    blocks: PromptBlock[],
    result: ReadonlyMap<string, PromptBlockResult>
): LLMMessage[] {
    return [...blocks]
        .sort((a, b) => compareSortOrder(a.sortOrder, b.sortOrder))
        .flatMap((block) => result.get(block.id)?.messages ?? []);
}

function makeMessage(role: LLMRole, content: string): LLMMessage[] {
    const trimmed = content.trim();
    if (!trimmed) return [];
    return [{ role, content: [{ type: 'text', text: trimmed }] }];
}

function createPromptBudget(agent: AgentPromptConfig): PromptBudget {
    const input = agent.maxContext - agent.maxResponse;
    if (input <= 0) {
        throw new AppError('INVALID_INPUT', 'Prompt input budget must be greater than zero');
    }

    return {
        input,
        used: 0,
        lorebookCap: Math.floor(input * agent.lorebookRatio),
        memoryCap: Math.floor(input * agent.memoryRatio)
    };
}

function isLorebookBlock(block: PromptBlock): block is LorebookPromptBlock {
    return block.type === 'lorebook';
}

function isBoundedHistory(block: PromptBlock): boolean {
    return block.type === 'history' && block.start !== undefined;
}

function isUnboundedHistoryBlock(block: PromptBlock): boolean {
    return block.type === 'history' && block.start === undefined;
}

function isFixedBlock(block: PromptBlock): boolean {
    if (block.type === 'history') return isBoundedHistory(block);
    return block.type !== 'lorebook';
}

function getLorebookBudget(budget: PromptBudget): number {
    return Math.min(budget.lorebookCap, Math.max(0, budget.input - budget.used));
}

function sumBlockTokens(results: ReadonlyMap<string, PromptBlockResult>): number {
    let total = 0;
    for (const result of results.values()) {
        total += result.tokens;
    }
    return total;
}

function validateLorebookBlockRanges(blocks: LorebookPromptBlock[]): void {
    const ranges = blocks
        .map((block) => ({
            block,
            min: block.minDepth ?? Number.NEGATIVE_INFINITY,
            max: block.maxDepth ?? Number.POSITIVE_INFINITY
        }))
        .sort((a, b) => a.min - b.min || a.max - b.max);

    for (const range of ranges) {
        if (range.min > range.max) {
            throw new AppError(
                'INVALID_INPUT',
                `Invalid lorebook depth range in prompt block: ${range.block.name}`
            );
        }
    }

    for (let index = 1; index < ranges.length; index += 1) {
        const previous = ranges[index - 1];
        const current = ranges[index];
        if (previous.max >= current.min) {
            throw new AppError(
                'INVALID_INPUT',
                `Overlapping lorebook depth ranges: ${previous.block.name}, ${current.block.name}`
            );
        }
    }
}

function isDepthInRange(depth: number, block: LorebookPromptBlock): boolean {
    if (block.minDepth !== undefined && depth < block.minDepth) return false;
    if (block.maxDepth !== undefined && depth > block.maxDepth) return false;
    return true;
}

async function renderHistoryMessage(
    message: Message,
    messageIndex: number,
    ctx: RuntimeContext,
    chat: Chat,
    historyMode: 'last_content' | 'full_trace',
    format?: string,
    localMacros?: ReadonlyMap<string, Macro>
): Promise<LLMMessage[]> {
    const activeSwipe = message.swipes[message.activeSwipeId];
    if (!activeSwipe) return [];

    const messageCtx = toMessageContext(message, messageIndex, ctx);
    const templateMacros = mergeLocalMacros(localMacros, createDryRunMacros());

    if (historyMode === 'last_content') {
        const content = await renderHistoryText(
            getLastContentText(activeSwipe.parts),
            format,
            messageCtx,
            activeSwipe.speakerName,
            templateMacros
        );
        return [
            {
                role: message.role,
                content: await addAttachmentContent(content, activeSwipe.attachments, chat)
            }
        ];
    }

    const toolCallIds = activeSwipe.parts
        .filter((part) => part.type === 'tool_call')
        .map((part) => part.id);
    const loadedToolCalls = await Promise.all(toolCallIds.map((id) => ToolCallService.get(id)));
    const toolCalls = new Map(
        toolCallIds.map((id, index) => [id, loadedToolCalls[index]] as const)
    );
    const messages: LLMMessage[] = [];
    let content: LLMContentPart[] = [];
    const flush = (): void => {
        if (content.length === 0) return;
        messages.push({ role: message.role, content });
        content = [];
    };

    for (const part of activeSwipe.parts) {
        if (part.type === 'thought') continue;
        if (part.type === 'content') {
            const rendered = await renderHistoryText(
                part.text,
                format,
                messageCtx,
                activeSwipe.speakerName,
                templateMacros
            );
            if (rendered) content.push({ type: 'text', text: rendered });
            continue;
        }

        const toolCall = toolCalls.get(part.id);
        if (!toolCall) {
            content.push({
                type: 'text',
                text: `[Tool call: ${part.name} — ${part.status}; details unavailable]`
            });
            continue;
        }

        content.push({
            type: 'tool_request',
            callId: toolCall.call.callId,
            name: toolCall.call.name,
            args: toolCall.call.args
        });
        flush();
        const response: LLMContentPart = {
            type: 'tool_response',
            callId: toolCall.call.callId,
            name: toolCall.call.name,
            content: toolCall.response ?? [{ type: 'text', text: 'Tool call did not complete.' }]
        };
        if (!toolCall.response || toolCall.status === 'error' || toolCall.status === 'rejected') {
            response.isError = true;
        }
        messages.push({
            role: 'user',
            content: [response]
        });
    }
    flush();

    const attachmentParts = await loadAttachmentContent(activeSwipe.attachments, chat);
    if (attachmentParts.length > 0) {
        const target = messages.find((entry) => entry.role === message.role);
        if (target) target.content.push(...attachmentParts);
        else messages.unshift({ role: message.role, content: attachmentParts });
    }
    return messages;
}

async function renderHistoryText(
    text: string,
    format: string | undefined,
    messageCtx: RuntimeContext,
    speakerName: string | undefined,
    templateMacros: ReadonlyMap<string, Macro>
): Promise<string> {
    const templated = await renderWithFormat(text, format, messageCtx, speakerName, templateMacros);
    const processed = await runPipeline('request', messageCtx, templated);
    return runTemplate(processed, messageCtx, templateMacros);
}

async function resolveHistoryIndex(
    value: string | undefined,
    ctx: RuntimeContext,
    templateMacros: ReadonlyMap<string, Macro>,
    label: string,
    blockName: string
): Promise<number | undefined> {
    if (value === undefined) return undefined;
    const resolved = (await runTemplate(value, ctx, templateMacros)).trim();
    if (resolved === '') return undefined;
    const parsed = Number(resolved);
    if (!Number.isFinite(parsed)) {
        throw new AppError(
            'INVALID_INPUT',
            `History block "${blockName}" ${label} must resolve to a number: "${value}"`
        );
    }
    return parsed;
}

async function addAttachmentContent(
    content: string,
    attachments: string[] | undefined,
    chat: Chat
): Promise<LLMContentPart[]> {
    return [{ type: 'text', text: content }, ...(await loadAttachmentContent(attachments, chat))];
}

async function loadAttachmentContent(
    attachments: string[] | undefined,
    chat: Chat
): Promise<LLMContentPart[]> {
    if (!attachments?.length) return [];
    const parts: LLMContentPart[] = [];
    for (const attachmentId of attachments) {
        const ref = chat.inlays.refs[attachmentId];
        if (!ref) continue;

        const bytes = await AssetService.readBytes({
            scopeType: chat.scopeType,
            scopeId: chat.scopeId,
            ownerTable: 'chats',
            ownerId: chat.id,
            hash: ref.hash
        });
        if (!bytes) continue;

        const mediaType = getAssetMediaType(ref.mimeType);
        if (mediaType === 'other') continue;

        parts.push({
            type: mediaType,
            mimeType: ref.mimeType,
            data: toBase64(new Uint8Array(bytes))
        });
    }

    return parts;
}

async function renderWithFormat(
    content: string,
    format: string | undefined,
    ctx: RuntimeContext,
    name?: string,
    overrides?: ReadonlyMap<string, Macro>
): Promise<string> {
    const localMacros = new Map<string, Macro>(overrides);
    const upstreamSlot = localMacros.get('slot');
    localMacros.set('slot', {
        run: (args, macroCtx) => {
            if (args.length === 0) return content;
            if (upstreamSlot) return upstreamSlot.run(args, macroCtx);
            throw new Error('slot not handled');
        },
        recursive: true
    });
    localMacros.set('name', {
        run: (args) => {
            if (args.length !== 0) {
                throw new Error('Format name macro must be called as {{name}}');
            }
            return name ?? '';
        },
        recursive: true
    });

    const resolvedFormat = format?.trim() ? format : '{{slot}}';
    return await runTemplate(resolvedFormat, ctx, localMacros);
}

async function countMessages(messages: LLMMessage[], tokenizer: LLMTokenizer): Promise<number> {
    if (messages.length === 0) return 0;
    return TokenCounter.count(
        messages
            .map((message) => message.content.map(contentPartForTokenCount).join('\n'))
            .join('\n'),
        tokenizer
    );
}

async function countToolDefinitions(toolIds: string[], tokenizer: LLMTokenizer): Promise<number> {
    if (toolIds.length === 0) return 0;
    return TokenCounter.count(JSON.stringify(resolveAgentTools(toolIds)), tokenizer);
}

function contentPartForTokenCount(part: LLMContentPart): string {
    switch (part.type) {
        case 'text':
            return part.text;
        case 'image':
            return `[image:${part.mimeType}]`;
        case 'audio':
            return `[audio:${part.mimeType}]`;
        case 'video':
            return `[video:${part.mimeType}]`;
        case 'tool_request':
            return JSON.stringify({ name: part.name, arguments: part.args });
        case 'tool_response':
            return JSON.stringify({
                name: part.name,
                content: part.content,
                isError: part.isError ?? false
            });
    }
}
