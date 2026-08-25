/**
 * Prompt Builder — KeiAI
 *
 * Assembles OpenAI-compatible messages from preset prompt blocks.
 * History is loaded lazily through PagedMessages when a history block needs it.
 */

import type { PagedMessages } from '$lib/services/content/paged_messages';
import type { Character, Chat, Persona, Lorebook } from '$lib/services';
import type { LLMContentPart, LLMFilePart, LLMMessage } from '../../llm/types';
import type { LLMRole, LLMTokenizer } from '$lib/types/models/llm';
import { runPipeline } from '$lib/pipeline';
import { runTemplate, createDryRunMacros, mergeLocalMacros } from '$lib/template';
import type { Macro } from '$lib/template';
import { TokenCounter } from '$lib/llm/tokenizer';
import { AppError } from '$lib/types/errors';
import type { Message } from '$lib/services/content/message';
import { resolveLorebookEntries } from './lorebook';
import {
    agentPartsToLLMMessages,
    deserializeAgentParts,
    getLastTextPart,
    getTextContent,
    getVisibleParts,
    type AgentPart
} from './llm';
import { resolveAgentTools } from './tool';
import { toMessageContext, toRoleContext } from './context';
import { compareSortOrder } from '$lib/utils/ordering';
import type { RuntimeContext } from '$lib/types/context';
import type {
    HistoryPromptBlock,
    LorebookPromptBlock,
    MemoryPromptBlock,
    MessagePromptBlock,
    PromptBlock
} from '../types';
import { resolveMemoryAlgorithm } from './memory';

// ─── Input ────────────────────────────────────────────────────────────────────

export interface PromptInput {
    chat: Chat;
    agent: AgentPromptConfig;
    lorebooks: Lorebook[];
    messages: PagedMessages;
    tokenizer: LLMTokenizer;
    ctx: RuntimeContext;
    signal: AbortSignal;
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

type LorebookBucketEntry = {
    order: number;
    message: LLMMessage;
};

interface ResolvedBlockRange<TBlock extends HistoryPromptBlock | MemoryPromptBlock> {
    block: TBlock;
    start: number;
    end: number;
}

interface HistoryPlan {
    results: Map<string, PromptBlockResult>;
    tokens: number;
    cutoff: number;
}

// Providers tokenize native file parts server-side, so the prompt budget only
// reserves a nominal slot instead of estimating tokens from raw bytes.
const NATIVE_FILE_TOKEN_ESTIMATE = 1_000;

// ─── Builder ──────────────────────────────────────────────────────────────────

export async function buildPrompt(input: PromptInput): Promise<LLMMessage[]> {
    const blocks = getEnabledPromptBlocks(input.agent.promptBlocks);
    const historyRanges = await resolveBlockRanges(blocks.filter(isHistoryBlock), input);
    const memoryRanges = await resolveBlockRanges(blocks.filter(isMemoryBlock), input);

    const budget = createPromptBudget(input.agent);
    const toolTokens = await countToolDefinitions(input.agent.toolIds, input.tokenizer);
    budget.used += toolTokens;
    if (budget.used > budget.input) {
        throw new AppError('INVALID_INPUT', 'Tool definitions exceed the prompt input budget');
    }
    const result = new Map<string, PromptBlockResult>();

    for (const block of blocks.filter(isMessageBlock)) {
        const res = await buildMessageBlock(block, input);

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

    const available = Math.max(0, budget.input - budget.used);
    const hasConfiguredMemory = memoryRanges.some(
        ({ block, start, end }) =>
            start < end && Number.isFinite(block.importance) && block.importance > 0
    );
    const memoryBudget = hasConfiguredMemory ? Math.min(budget.memoryCap, available) : 0;
    const historyBudget = available - memoryBudget;
    const historyPlan = await buildHistoryBlocks(historyRanges, input, historyBudget);
    for (const [blockId, res] of historyPlan.results) {
        result.set(blockId, res);
    }
    budget.used += historyPlan.tokens;

    const effectiveMemoryRanges = memoryRanges
        .map(({ block, start, end }) => ({
            block,
            start,
            end: Math.min(end, historyPlan.cutoff)
        }))
        .filter(
            ({ block, start, end }) =>
                start < end && Number.isFinite(block.importance) && block.importance > 0
        );
    const memoryResults = await buildMemoryBlocks(effectiveMemoryRanges, input, memoryBudget);
    for (const [blockId, res] of memoryResults) {
        result.set(blockId, res);
    }
    budget.used += sumBlockTokens(memoryResults);

    const prompt = flattenBlocks(blocks, result);
    const finalTokens = toolTokens + (await countMessages(prompt, input.tokenizer));
    if (finalTokens > budget.input) {
        throw new AppError('INVALID_INPUT', 'Final prompt exceeds the prompt input budget');
    }
    return prompt;
}

// ─── Block Builders ─────────────────────────────────────────────────────────

async function buildMessageBlock(
    block: MessagePromptBlock,
    input: PromptInput
): Promise<PromptBlockResult> {
    let messages: LLMMessage[] = [];
    const templateMacros = mergeLocalMacros(input.localMacros, createDryRunMacros());

    const content = (
        await runTemplate(block.content, toRoleContext(input.ctx, block.role), templateMacros)
    ).trim();
    messages = await agentPartsToLLMMessages(
        deserializeAgentParts(content),
        block.role,
        input.chat
    );

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

async function buildHistoryBlocks(
    ranges: ResolvedBlockRange<HistoryPromptBlock>[],
    input: PromptInput,
    historyBudget: number
): Promise<HistoryPlan> {
    const results = new Map<string, PromptBlockResult>(
        ranges.map(({ block }) => [block.id, { messages: [], tokens: 0 }])
    );
    let used = 0;
    let failedIndex: number | undefined;
    let oldestSelectedIndex: number | undefined;

    for (let index = input.messages.length - 1; index >= 0; index -= 1) {
        const covering = ranges.filter(({ start, end }) => start <= index && index < end);
        if (covering.length === 0) continue;

        const indexed = await input.messages.at(index);
        if (!indexed) continue;

        const layer: Array<{ blockId: string; messages: LLMMessage[]; tokens: number }> = [];
        let layerTokens = 0;
        for (const { block } of covering) {
            const messages = await renderHistoryMessage(
                indexed.message,
                indexed.index,
                input.ctx,
                input.chat,
                block.historyMode,
                block.format,
                input.localMacros
            );
            if (messages.length === 0) continue;
            const tokens = await countMessages(messages, input.tokenizer);
            if (tokens === 0) continue;
            layer.push({ blockId: block.id, messages, tokens });
            layerTokens += tokens;
        }
        if (layer.length === 0) continue;

        if (used + layerTokens > historyBudget) {
            failedIndex = index;
            break;
        }

        for (const contribution of layer) {
            const bucket = results.get(contribution.blockId);
            if (!bucket) continue;
            bucket.messages.unshift(...contribution.messages);
            bucket.tokens += contribution.tokens;
        }
        used += layerTokens;
        oldestSelectedIndex = index;
    }

    const cutoff =
        failedIndex !== undefined
            ? failedIndex + 1
            : (oldestSelectedIndex ?? input.messages.length);
    return { results, tokens: used, cutoff };
}

async function buildMemoryBlocks(
    ranges: ResolvedBlockRange<MemoryPromptBlock>[],
    input: PromptInput,
    memoryBudget: number
): Promise<Map<string, PromptBlockResult>> {
    const results = new Map<string, PromptBlockResult>(
        ranges.map(({ block }) => [block.id, { messages: [], tokens: 0 }])
    );
    const blockBudgets = allocateMemoryBudgets(ranges, memoryBudget);

    for (const { block, start, end } of ranges) {
        const blockBudget = blockBudgets.get(block.id) ?? 0;
        if (blockBudget <= 0) continue;

        const phrases = await resolveMemoryAlgorithm(block.algorithmId, {
            messages: input.messages,
            start,
            end,
            config: block.algorithmConfig ?? {},
            ctx: input.ctx,
            signal: input.signal
        });
        const ordered = phrases
            .map((phrase, index) => ({ phrase, index }))
            .filter(
                ({ phrase }) =>
                    phrase.content.trim().length > 0 && Number.isFinite(phrase.importance)
            )
            .sort((a, b) => b.phrase.importance - a.phrase.importance || a.index - b.index);
        const bucket = results.get(block.id);
        if (!bucket) continue;
        let remaining = blockBudget;

        for (const { phrase } of ordered) {
            const templateMacros = mergeLocalMacros(input.localMacros, createDryRunMacros());
            const content = await renderWithFormat(
                phrase.content,
                block.format,
                toRoleContext(input.ctx, block.role),
                undefined,
                templateMacros
            );
            const messages = makeMessage(block.role, content);
            const tokens = await countMessages(messages, input.tokenizer);
            if (messages.length === 0 || tokens === 0) continue;
            if (tokens > remaining) continue;

            bucket.messages.push(...messages);
            bucket.tokens += tokens;
            remaining -= tokens;
        }
    }

    return results;
}

function allocateMemoryBudgets(
    ranges: ResolvedBlockRange<MemoryPromptBlock>[],
    memoryBudget: number
): Map<string, number> {
    const budgets = new Map<string, number>();
    if (memoryBudget <= 0 || ranges.length === 0) return budgets;

    const totalWeight = ranges.reduce((sum, { block }) => sum + block.importance, 0);
    if (totalWeight <= 0) return budgets;

    let allocated = 0;
    for (const { block } of ranges) {
        const budget = Math.floor((memoryBudget * block.importance) / totalWeight);
        budgets.set(block.id, budget);
        allocated += budget;
    }

    let remainder = memoryBudget - allocated;
    for (const { block } of ranges) {
        if (remainder <= 0) break;
        budgets.set(block.id, (budgets.get(block.id) ?? 0) + 1);
        remainder -= 1;
    }
    return budgets;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getEnabledPromptBlocks(blocks: Record<string, PromptBlock>): PromptBlock[] {
    return Object.values(blocks)
        .filter((block) => block.enabled)
        .sort(comparePromptBlocks);
}

function flattenBlocks(
    blocks: PromptBlock[],
    result: ReadonlyMap<string, PromptBlockResult>
): LLMMessage[] {
    return [...blocks]
        .sort(comparePromptBlocks)
        .flatMap((block) => result.get(block.id)?.messages ?? []);
}

function comparePromptBlocks(a: PromptBlock, b: PromptBlock): number {
    return compareSortOrder(a.sortOrder, b.sortOrder) || a.id.localeCompare(b.id);
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

function isMessageBlock(block: PromptBlock): block is MessagePromptBlock {
    return block.type === 'message';
}

function isHistoryBlock(block: PromptBlock): block is HistoryPromptBlock {
    return block.type === 'history';
}

function isMemoryBlock(block: PromptBlock): block is MemoryPromptBlock {
    return block.type === 'memory';
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
    historyMode: 'last_text' | 'visible' | 'full_trace',
    format?: string,
    localMacros?: ReadonlyMap<string, Macro>
): Promise<LLMMessage[]> {
    const activeSwipe = message.swipes[message.activeSwipeId];
    if (!activeSwipe) return [];

    const messageCtx = toMessageContext(message, messageIndex, ctx);
    const templateMacros = mergeLocalMacros(localMacros, createDryRunMacros());
    let selectedParts: AgentPart[];
    if (historyMode === 'last_text') {
        const lastTextPart = getLastTextPart(activeSwipe.parts);
        selectedParts = lastTextPart ? [lastTextPart] : [];
    } else if (historyMode === 'visible') {
        selectedParts = getVisibleParts(activeSwipe.parts).filter(
            (part) => part.type === 'text' || part.type === 'inlay'
        );
    } else {
        selectedParts = activeSwipe.parts;
    }
    const renderedParts: AgentPart[] = [];

    for (const part of selectedParts) {
        if (part.type === 'text') {
            const rendered = await renderHistoryText(
                part.text,
                format,
                messageCtx,
                activeSwipe.speakerName,
                templateMacros
            );
            if (rendered) renderedParts.push({ type: 'text', text: rendered });
            continue;
        }
        renderedParts.push(part);
    }

    return agentPartsToLLMMessages(renderedParts, message.role, chat);
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

async function resolveBlockRanges<TBlock extends HistoryPromptBlock | MemoryPromptBlock>(
    blocks: TBlock[],
    input: PromptInput
): Promise<ResolvedBlockRange<TBlock>[]> {
    const templateMacros = mergeLocalMacros(input.localMacros, createDryRunMacros());
    return Promise.all(
        blocks.map(async (block) => {
            const rawStart = await resolveBlockIndex(
                block.start,
                input.ctx,
                templateMacros,
                'start',
                block
            );
            const rawEnd = await resolveBlockIndex(
                block.end,
                input.ctx,
                templateMacros,
                'end',
                block
            );
            return {
                block,
                start: input.messages.normalizeIndex(rawStart ?? 0),
                end: input.messages.normalizeIndex(rawEnd ?? input.messages.length)
            };
        })
    );
}

async function resolveBlockIndex(
    value: string | undefined,
    ctx: RuntimeContext,
    templateMacros: ReadonlyMap<string, Macro>,
    label: string,
    block: HistoryPromptBlock | MemoryPromptBlock
): Promise<number | undefined> {
    if (value === undefined) return undefined;
    const resolved = (await runTemplate(value, ctx, templateMacros)).trim();
    if (resolved === '') return undefined;
    const parsed = Number(resolved);
    if (!Number.isFinite(parsed)) {
        throw new AppError(
            'INVALID_INPUT',
            `${block.type === 'history' ? 'History' : 'Memory'} block "${block.name}" ${label} must resolve to a number: "${value}"`
        );
    }
    return parsed;
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

    const textParts: string[] = [];
    const fileCounts: Promise<number>[] = [];
    for (const message of messages) {
        for (const part of message.content) {
            if (part.type === 'file') {
                fileCounts.push(countFileTokens(part, tokenizer));
            } else {
                textParts.push(contentPartForTokenCount(part));
            }
        }
    }

    const textTokens =
        textParts.length > 0 ? await TokenCounter.count(textParts.join('\n'), tokenizer) : 0;
    const fileTokens = (await Promise.all(fileCounts)).reduce((total, count) => total + count, 0);
    return textTokens + fileTokens;
}

async function countToolDefinitions(toolIds: string[], tokenizer: LLMTokenizer): Promise<number> {
    if (toolIds.length === 0) return 0;
    return TokenCounter.count(JSON.stringify(resolveAgentTools(toolIds)), tokenizer);
}

function contentPartForTokenCount(part: Exclude<LLMContentPart, LLMFilePart>): string {
    switch (part.type) {
        case 'text':
            return part.text;
        case 'thought':
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

function countFileTokens(part: LLMFilePart, tokenizer: LLMTokenizer): Promise<number> {
    return TokenCounter.count(`[file:${part.name}:${part.mimeType}]`, tokenizer).then(
        (tokens) => tokens + NATIVE_FILE_TOKEN_ESTIMATE
    );
}
