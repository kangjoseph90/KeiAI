/**
 * Prompt Builder — KeiAI
 *
 * Assembles OpenAI-compatible messages from preset prompt blocks.
 * History is loaded lazily through PagedMessages when a history block needs it.
 */

import type { PromptBlock } from '$lib/services/content/preset';
import type { PagedMessages } from '$lib/services/content/paged_messages';
import type { Character, Chat, Preset, Persona, Lorebook } from '$lib/services';
import type { OpenAIChat } from '../types';
import type { LLMRole, LLMTokenizer } from '$lib/types/models/llm';
import { collectPipelineHandlers, runPipelineHandlers } from '$lib/pipeline';
import { collectTemplateMacros, runTemplate } from '$lib/template';
import type { TemplateContext, Macro } from '$lib/template';
import type { PipelineHandler } from '$lib/pipeline/types';
import { TokenCounter } from '$lib/llm/tokenizer';
import { AppError } from '$lib/types/errors';
import type { Message } from '$lib/services/content/message';

// ─── Input ────────────────────────────────────────────────────────────────────

export interface PromptInput {
    character: Character;
    chat: Chat;
    preset: Preset | null;
    persona: Persona | null;
    lorebooks: Lorebook[];
    messages: PagedMessages;
    tokenizer: LLMTokenizer;
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

// ─── Builder ──────────────────────────────────────────────────────────────────

export async function buildPrompt(input: PromptInput): Promise<OpenAIChat[]> {
    const blocks = getEnabledPromptBlocks(input.preset?.promptBlocks ?? {});
    if (!input.preset) return [];

    const budget = createPromptBudget(input.preset);
    const result = new Map<string, PromptBlockResult>();
    const elasticBlocks = blocks.filter(isElasticBlock);
    const templateCtx: TemplateContext = {
        characterId: input.chat.characterId,
        personaId: input.persona?.id,
        chatId: input.chat.id,
        display: false,
        dryRun: false
    };

    if (elasticBlocks.length > 1) {
        throw new AppError('INVALID_INPUT', 'Prompt can only have one unbounded history block');
    }

    const [templateMacros, requestHandlers] = await Promise.all([
        collectTemplateMacros(templateCtx),
        collectPipelineHandlers(input.chat.id, 'request')
    ]);

    for (const block of blocks.filter(isFixedBlock)) {
        const res = await buildFixedBlock(
            block,
            input,
            templateCtx,
            templateMacros,
            requestHandlers,
            input.tokenizer
        );

        if (budget.used + res.tokens > budget.input) {
            throw new AppError(
                'INVALID_INPUT',
                `Prompt budget exceeded while processing fixed block: ${block.name}`
            );
        }

        result.set(block.id, res);
        budget.used += res.tokens;
    }

    for (const block of blocks.filter(isDynamicBlock)) {
        const blockBudget = getDynamicBudget(block, budget);
        const res = await buildDynamicBlock(
            block,
            input,
            templateCtx,
            templateMacros,
            requestHandlers,
            input.tokenizer,
            blockBudget
        );

        if (res.tokens > blockBudget) {
            throw new AppError(
                'INVALID_INPUT',
                `Prompt budget exceeded while processing dynamic block: ${block.name}`
            );
        }

        result.set(block.id, res);
        budget.used += res.tokens;
    }

    for (const block of elasticBlocks) {
        const elasticBudget = Math.max(0, budget.input - budget.used);
        const res = await buildElasticBlock(
            block,
            input,
            templateCtx,
            templateMacros,
            requestHandlers,
            input.tokenizer,
            elasticBudget
        );

        result.set(block.id, res);
        budget.used += res.tokens;
    }

    return flattenBlocks(blocks, result);
}

// ─── Block Builders ─────────────────────────────────────────────────────────

async function buildFixedBlock(
    block: PromptBlock,
    input: PromptInput,
    templateCtx: TemplateContext,
    templateMacros: ReadonlyMap<string, Macro>,
    requestHandlers: PipelineHandler<string, 'request'>[],
    tokenizer: LLMTokenizer
): Promise<PromptBlockResult> {
    let messages: OpenAIChat[] = [];

    switch (block.type) {
        case 'text':
            messages = makeMessage(
                block.role,
                await runTemplate(block.content, templateCtx, templateMacros)
            );
            break;

        case 'character':
            messages = makeMessage(
                block.role,
                await runTemplate(input.character.description, templateCtx, templateMacros)
            );
            break;

        case 'characterNote':
            messages = makeMessage(
                block.role,
                await runTemplate(input.character.characterNote, templateCtx, templateMacros)
            );
            break;

        case 'persona':
            if (input.persona) {
                messages = makeMessage(
                    block.role,
                    await runTemplate(input.persona.description, templateCtx, templateMacros)
                );
            }
            break;

        case 'chatNote':
            messages = makeMessage(
                block.role,
                await runTemplate(input.chat.chatNote, templateCtx, templateMacros)
            );
            break;

        case 'history': {
            // Only bounded history gets processed here
            const slice = await input.messages.slice(block.start, block.end);
            for (const msg of slice) {
                const rendered = await renderHistoryMessage(
                    msg,
                    templateCtx,
                    templateMacros,
                    requestHandlers
                );
                if (rendered) messages.push(rendered);
            }
            break;
        }
    }

    const tokens = await countMessages(messages, tokenizer);
    return { messages, tokens };
}

async function buildDynamicBlock(
    block: PromptBlock,
    input: PromptInput,
    templateCtx: TemplateContext,
    templateMacros: ReadonlyMap<string, Macro>,
    requestHandlers: PipelineHandler<string, 'request'>[],
    tokenizer: LLMTokenizer,
    budget: number
): Promise<PromptBlockResult> {
    if (budget <= 0) return { messages: [], tokens: 0 };

    const messages: OpenAIChat[] = [];

    switch (block.type) {
        case 'lorebook':
            // TODO: Process entries one by one until reaching `budget`
            break;

        case 'memory':
            // TODO: Process memory summaries until reaching `budget`
            break;
    }

    const tokens = await countMessages(messages, tokenizer);
    return { messages, tokens };
}

async function buildElasticBlock(
    block: PromptBlock,
    input: PromptInput,
    templateCtx: TemplateContext,
    templateMacros: ReadonlyMap<string, Macro>,
    requestHandlers: PipelineHandler<string, 'request'>[],
    tokenizer: LLMTokenizer,
    elasticBudget: number
): Promise<PromptBlockResult> {
    const messages: OpenAIChat[] = [];
    let remaining = Math.max(0, elasticBudget);
    let sawRenderableMessage = false;

    for (let index = input.messages.length - 1; index >= 0; index -= 1) {
        const msg = await input.messages.at(index);
        if (!msg) continue;

        const rendered = await renderHistoryMessage(
            msg,
            templateCtx,
            templateMacros,
            requestHandlers
        );
        if (!rendered) continue;

        sawRenderableMessage = true;
        const tokens = await countMessages([rendered], tokenizer);
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

    const totalTokens = await countMessages(messages, tokenizer);
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

function isDynamicBlock(block: PromptBlock): boolean {
    return block.type === 'lorebook' || block.type === 'memory';
}

function isBoundedHistory(block: PromptBlock): boolean {
    return block.type === 'history' && block.start !== undefined;
}

function isElasticBlock(block: PromptBlock): boolean {
    return block.type === 'history' && block.start === undefined;
}

function isFixedBlock(block: PromptBlock): boolean {
    if (block.type === 'history') return isBoundedHistory(block);
    return !isDynamicBlock(block);
}

function getDynamicBudget(block: PromptBlock, budget: PromptBudget): number {
    const remaining = Math.max(0, budget.input - budget.used);
    if (block.type === 'lorebook') return Math.min(budget.lorebookCap, remaining);
    if (block.type === 'memory') return Math.min(budget.memoryCap, remaining);
    return 0;
}

async function renderHistoryMessage(
    msg: Message,
    templateCtx: TemplateContext,
    templateMacros: ReadonlyMap<string, Macro>,
    requestHandlers: PipelineHandler<string, 'request'>[]
): Promise<OpenAIChat | null> {
    const activeSwipe = msg.swipes[msg.activeSwipeId];
    if (!activeSwipe) return null;

    const messageCtx: TemplateContext = {
        ...templateCtx,
        messageId: msg.id
    };
    const templated = await runTemplate(activeSwipe.content, messageCtx, templateMacros);
    const processed = await runPipelineHandlers(requestHandlers, templated, {
        role: msg.role
    });
    const content = await runTemplate(processed, messageCtx, templateMacros);

    return {
        role: msg.role,
        content,
        thought: activeSwipe.thought
    };
}

async function countMessages(messages: OpenAIChat[], tokenizer: LLMTokenizer): Promise<number> {
    if (messages.length === 0) return 0;
    return TokenCounter.count(messages.map((message) => message.content).join('\n'), tokenizer);
}
