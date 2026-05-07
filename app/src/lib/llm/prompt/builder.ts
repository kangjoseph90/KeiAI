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
import type { LLMRole } from '$lib/types/models/llm';
import { collectPipelineHandlers, runPipelineHandlers } from '$lib/pipeline';
import { collectTemplateMacros, runTemplate } from '$lib/template';
import type { TemplateContext, Macro } from '$lib/template';
import type { PipelineHandler } from '$lib/pipeline/types';

// ─── Input ────────────────────────────────────────────────────────────────────

export interface PromptInput {
    character: Character;
    chat: Chat;
    preset: Preset | null;
    persona: Persona | null;
    lorebooks: Lorebook[];
    messages: PagedMessages;
}

// ─── Builder ──────────────────────────────────────────────────────────────────

export async function buildPrompt(input: PromptInput): Promise<OpenAIChat[]> {
    const blocks = sortPromptBlocks(input.preset?.promptBlocks ?? {});
    const result: OpenAIChat[] = [];
    const templateCtx: TemplateContext = {
        characterId: input.chat.characterId,
        personaId: input.persona?.id,
        chatId: input.chat.id,
        display: false,
        dryRun: false
    };
    const [templateMacros, requestHandlers] = await Promise.all([
        collectTemplateMacros(templateCtx),
        collectPipelineHandlers(input.chat.id, 'request')
    ]);

    for (const block of blocks) {
        await processBlock(block, input, result, templateCtx, templateMacros, requestHandlers);
    }

    return result;
}

// ─── Block Processing ─────────────────────────────────────────────────────────

async function processBlock(
    block: PromptBlock,
    input: PromptInput,
    result: OpenAIChat[],
    templateCtx: TemplateContext,
    templateMacros: ReadonlyMap<string, Macro>,
    requestHandlers: PipelineHandler<string, 'request'>[]
): Promise<void> {
    switch (block.type) {
        case 'text':
            appendMessage(
                result,
                block.role,
                await runTemplate(block.content, templateCtx, templateMacros)
            );
            break;

        case 'character':
            appendMessage(
                result,
                block.role,
                await runTemplate(input.character.description, templateCtx, templateMacros)
            );
            break;

        case 'characterNote':
            appendMessage(
                result,
                block.role,
                await runTemplate(input.character.characterNote, templateCtx, templateMacros)
            );
            break;

        case 'persona':
            if (input.persona) {
                appendMessage(
                    result,
                    block.role,
                    await runTemplate(input.persona.description, templateCtx, templateMacros)
                );
            }
            break;

        case 'chatNote':
            appendMessage(
                result,
                block.role,
                await runTemplate(input.chat.chatNote, templateCtx, templateMacros)
            );
            break;

        case 'lorebook':
            // TODO: Resolve activated lorebook entries once the lorebook engine is defined.
            break;

        case 'memory':
            // TODO: Resolve memory summaries once the memory service is defined.
            break;

        case 'history':
            for (const msg of await input.messages.slice(block.start, block.end)) {
                const activeSwipe = msg.swipes[msg.activeSwipeId];
                if (!activeSwipe) continue;
                const messageCtx: TemplateContext = {
                    ...templateCtx,
                    messageId: msg.id
                };
                const templated = await runTemplate(
                    activeSwipe.content,
                    messageCtx,
                    templateMacros
                );
                const processed = await runPipelineHandlers(requestHandlers, templated, {
                    role: msg.role
                });
                const content = await runTemplate(processed, messageCtx, templateMacros);
                result.push({
                    role: msg.role,
                    content,
                    thought: activeSwipe.thought
                });
            }
            break;
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sortPromptBlocks(blocks: Record<string, PromptBlock>): PromptBlock[] {
    return Object.values(blocks)
        .filter((block) => block.enabled)
        .sort((a, b) => a.sortOrder.localeCompare(b.sortOrder));
}

function appendMessage(result: OpenAIChat[], role: LLMRole, content: string): void {
    const trimmed = content.trim();
    if (!trimmed) return;
    result.push({ role, content: trimmed });
}
