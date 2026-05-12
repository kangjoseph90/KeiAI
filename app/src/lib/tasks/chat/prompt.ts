/**
 * Prompt Builder — KeiAI
 *
 * Assembles OpenAI-compatible messages from preset prompt blocks.
 * History is loaded lazily through PagedMessages when a history block needs it.
 */

import type { PromptBlock } from '$lib/services/content/preset';
import type { PagedMessages } from '$lib/services/content/paged_messages';
import type { Character, Chat, Preset, Persona, Lorebook } from '$lib/services';
import type { OpenAIChat } from '../../llm/types';
import type { LLMRole, LLMTokenizer } from '$lib/types/models/llm';
import { runPipeline } from '$lib/pipeline';
import { runTemplate } from '$lib/template';
import type { TemplateContext, Macro } from '$lib/template';
import { TokenCounter } from '$lib/llm/tokenizer';
import { AppError } from '$lib/types/errors';
import type { Message } from '$lib/services/content/message';
import { resolveLorebookEntries } from './lorebook';
import { toDryRunContext, toMessageContext, toRoleContext } from './context';

// ─── Input ────────────────────────────────────────────────────────────────────

export interface PromptInput {
    character: Character;
    chat: Chat;
    preset: Preset;
    persona: Persona;
    lorebooks: Lorebook[];
    messages: PagedMessages;
    tokenizer: LLMTokenizer;
    context: TemplateContext;
}

type PromptBlockResult = {
    messages: OpenAIChat[];
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
    message: OpenAIChat;
};

// ─── Builder ──────────────────────────────────────────────────────────────────

export async function buildPrompt(input: PromptInput): Promise<OpenAIChat[]> {
    const blocks = getEnabledPromptBlocks(input.preset.promptBlocks);

    const budget = createPromptBudget(input.preset);
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

    for (const block of blocks.filter(isMemoryBlock)) {
        const blockBudget = getMemoryBudget(block, budget);
        const res = await buildMemoryBlock(block, input, blockBudget);

        if (res.tokens > blockBudget) {
            throw new AppError(
                'INVALID_INPUT',
                `Prompt budget exceeded while processing dynamic block: ${block.name}`
            );
        }

        result.set(block.id, res);
        budget.used += res.tokens;
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
    let messages: OpenAIChat[] = [];

    switch (block.type) {
        case 'text':
            messages = makeMessage(
                block.role,
                await runTemplate(block.content, toRoleContext(input.context, block.role))
            );
            break;

        case 'character':
            messages = makeMessage(
                block.role,
                await renderWithFormat(
                    input.character.description,
                    block.format,
                    toRoleContext(input.context, block.role),
                    input.character.name
                )
            );
            break;
        case 'characterNote':
            messages = makeMessage(
                block.role,
                await renderWithFormat(
                    input.character.characterNote,
                    block.format,
                    toRoleContext(input.context, block.role),
                    input.character.name
                )
            );
            break;

        case 'persona':
            messages = makeMessage(
                block.role,
                await renderWithFormat(
                    input.persona.description,
                    block.format,
                    toRoleContext(input.context, block.role),
                    input.persona.name
                )
            );
            break;

        case 'chatNote':
            messages = makeMessage(
                block.role,
                await renderWithFormat(
                    input.chat.chatNote,
                    block.format,
                    toRoleContext(input.context, block.role)
                )
            );
            break;

        case 'history': {
            // Only bounded history gets processed here
            const slice = await input.messages.slice(block.start, block.end);
            for (const { message, index } of slice) {
                const rendered = await renderHistoryMessage(
                    message,
                    index,
                    input.context,
                    block.format
                );
                if (rendered) messages.push(rendered);
            }
            break;
        }
    }

    const tokens = await countMessages(messages, input.tokenizer);
    return { messages, tokens };
}

async function buildMemoryBlock(
    block: PromptBlock,
    input: PromptInput,
    budget: number
): Promise<PromptBlockResult> {
    if (budget <= 0) return { messages: [], tokens: 0 };

    const messages: OpenAIChat[] = [];

    switch (block.type) {
        case 'memory':
            // TODO: Process memory summaries until reaching `budget`
            break;
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

    const templateCtx = toDryRunContext(input.context);

    const activeLorebooks = await resolveLorebookEntries({
        lorebooks: input.lorebooks,
        messages: input.messages,
        defaultScanDepth: input.preset?.lorebookScanDepth ?? 0,
        templateCtx
    });

    let used = 0;

    for (const lorebook of [...activeLorebooks].sort((a, b) => b.order - a.order)) {
        const block = blocks.find((candidate) => isDepthInRange(lorebook.depth, candidate));
        if (!block) continue;

        const content = await renderWithFormat(
            lorebook.content,
            block.format,
            toRoleContext(templateCtx, lorebook.role)
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

    const messages: OpenAIChat[] = [];
    let remaining = Math.max(0, remainingBudget);
    let sawRenderableMessage = false;

    for (let index = input.messages.length - 1; index >= 0; index -= 1) {
        const indexed = await input.messages.at(index);
        if (!indexed) continue;

        const rendered = await renderHistoryMessage(
            indexed.message,
            indexed.index,
            input.context,
            block.format
        );
        if (!rendered) continue;

        sawRenderableMessage = true;
        const tokens = await countMessages([rendered], input.tokenizer);
        if (tokens > remaining) {
            if (messages.length === 0) {
                throw new AppError(
                    'INVALID_INPUT',
                    `Latest history message does not fit in prompt budget: ${block.name}`
                );
            }
            break;
        }

        messages.unshift(rendered);
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
): OpenAIChat[] {
    return [...blocks]
        .sort((a, b) => a.sortOrder.localeCompare(b.sortOrder))
        .flatMap((block) => result.get(block.id)?.messages ?? []);
}

function makeMessage(role: LLMRole, content: string): OpenAIChat[] {
    const trimmed = content.trim();
    if (!trimmed) return [];
    return [{ role, content: trimmed }];
}

function createPromptBudget(preset: Preset): PromptBudget {
    const input = preset.maxContext - preset.maxResponse;
    if (input <= 0) {
        throw new AppError('INVALID_INPUT', 'Prompt input budget must be greater than zero');
    }

    return {
        input,
        used: 0,
        lorebookCap: Math.floor(input * preset.lorebookRatio),
        memoryCap: Math.floor(input * preset.memoryRatio)
    };
}

function isMemoryBlock(block: PromptBlock): boolean {
    return block.type === 'memory';
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
    return block.type !== 'lorebook' && block.type !== 'memory';
}

function getMemoryBudget(block: PromptBlock, budget: PromptBudget): number {
    const remaining = Math.max(0, budget.input - budget.used);
    if (block.type === 'memory') return Math.min(budget.memoryCap, remaining);
    return 0;
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
    templateCtx: TemplateContext,
    format?: string
): Promise<OpenAIChat | null> {
    const activeSwipe = message.swipes[message.activeSwipeId];
    if (!activeSwipe) return null;

    const messageCtx = toMessageContext(message, messageIndex, templateCtx);

    const templated = await renderWithFormat(
        activeSwipe.content,
        format,
        messageCtx,
        activeSwipe.speakerName
    );

    const processed = await runPipeline(
        templateCtx.chatId ?? message.chatId,
        'request',
        templated,
        messageCtx
    );

    const content = await runTemplate(processed, messageCtx);

    return {
        role: message.role,
        content,
        thought: activeSwipe.thought
    };
}

async function renderWithFormat(
    content: string,
    format: string | undefined,
    ctx: TemplateContext,
    name?: string
): Promise<string> {
    const localMacros = new Map<string, Macro>();
    localMacros.set('slot', {
        run: () => content,
        recursive: true
    });
    localMacros.set('name', {
        run: () => name ?? '',
        recursive: true
    });

    return await runTemplate(format ?? '{{slot}}', ctx, localMacros);
}

async function countMessages(messages: OpenAIChat[], tokenizer: LLMTokenizer): Promise<number> {
    if (messages.length === 0) return 0;
    return TokenCounter.count(messages.map((message) => message.content).join('\n'), tokenizer);
}
