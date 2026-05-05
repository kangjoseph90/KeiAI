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

    for (const block of blocks) {
        await processBlock(block, input, result);
    }

    return result;
}

// ─── Block Processing ─────────────────────────────────────────────────────────

async function processBlock(
    block: PromptBlock,
    input: PromptInput,
    result: OpenAIChat[]
): Promise<void> {
    switch (block.type) {
        case 'text':
            appendMessage(result, block.role, block.content);
            break;

        case 'character':
            appendMessage(result, block.role, input.character.description);
            break;

        case 'characterNote':
            appendMessage(result, block.role, input.character.characterNote);
            break;

        case 'persona':
            if (input.persona) {
                appendMessage(result, block.role, input.persona.description);
            }
            break;

        case 'chatNote':
            appendMessage(result, block.role, input.chat.chatNote);
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
                result.push({
                    role: msg.role,
                    content: activeSwipe.content,
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
