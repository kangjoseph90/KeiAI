/**
 * Prompt Builder — KeiAI
 *
 * Assembles OpenAI-compatible messages from injected domain data.
 * History is loaded lazily through PagedMessages when template entries need it.
 */

import type { PromptTemplateEntry } from '$lib/services/content/preset';
import { defaultPresetFields } from '$lib/services/content/preset';
import type { PagedMessages } from '$lib/services/content/paged_messages';
import type { Character, Preset, Persona, Lorebook } from '$lib/services';
import type { OpenAIChat } from '../types';

// ─── Input ────────────────────────────────────────────────────────────────────

export interface PromptInput {
    character: Character;
    preset: Preset | null;
    persona: Persona | null;
    lorebooks: Lorebook[];
    messages: PagedMessages;
}

// ─── Builder ──────────────────────────────────────────────────────────────────

export async function buildPrompt(input: PromptInput): Promise<OpenAIChat[]> {
    const templateOrder = input.preset?.templateOrder ?? defaultPresetFields.templateOrder;
    const result: OpenAIChat[] = [];

    for (const entry of templateOrder) {
        await processEntry(entry, input, result);
    }

    return result;
}

// ─── Entry Processing ─────────────────────────────────────────────────────────

async function processEntry(
    entry: PromptTemplateEntry,
    input: PromptInput,
    result: OpenAIChat[]
): Promise<void> {
    switch (entry.type) {
        case 'instruction':
            if (entry.content) {
                result.push({ role: entry.role, content: entry.content });
            }
            break;
        case 'description': {
            const desc = input.character.systemPrompt;
            if (desc) {
                result.push({ role: 'system', content: desc });
            }
            break;
        }
        case 'persona':
            if (input.persona) {
                result.push({ role: 'system', content: input.persona.description });
            }
            break;
        case 'lorebook': {
            const content = input.lorebooks
                .filter((lb) => lb.enabled)
                .map((lb) => lb.content)
                .filter(Boolean)
                .join('\n\n');
            if (content) {
                result.push({ role: 'system', content });
            }
            break;
        }
        case 'history':
            for (const msg of await input.messages.slice(entry.start, entry.end)) {
                const activeSwipe = msg.swipes[msg.activeSwipeId];
                if (!activeSwipe) continue;
                result.push({
                    role: mapMessageRole(msg.role),
                    content: activeSwipe.content,
                    thought: activeSwipe.thought
                });
            }
            break;
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mapMessageRole(role: string): 'system' | 'user' | 'assistant' {
    switch (role) {
        case 'char':
            return 'assistant';
        case 'user':
        case 'system':
            return role;
        default:
            return 'user';
    }
}
