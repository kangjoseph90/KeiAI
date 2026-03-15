/**
 * Prompt Builder — KeiAI
 *
 * Pure function that assembles OpenAI-compatible messages from domain data.
 * No classes, no hidden state — data in, messages out.
 */

import type { PromptTemplateEntry } from '$lib/services/content/preset';
import { defaultPresetData } from '$lib/services/content/preset';
import type { CharacterDetail, PresetDetail, Persona, Lorebook, Message } from '$lib/services';
import type { OpenAIChat } from '../types';

// ─── Input ────────────────────────────────────────────────────────────────────

export interface PromptInput {
	character: CharacterDetail;
	preset: PresetDetail | null;
	persona: Persona | null;
	lorebooks: Lorebook[];
	messages: Message[];
}

// ─── Builder ──────────────────────────────────────────────────────────────────

export function buildPrompt(input: PromptInput): OpenAIChat[] {
	const templateOrder = input.preset?.data.templateOrder ?? defaultPresetData.templateOrder;
	const result: OpenAIChat[] = [];

	for (const entry of templateOrder) {
		processEntry(entry, input, result);
	}

	return result;
}

// ─── Entry Processing ─────────────────────────────────────────────────────────

function processEntry(entry: PromptTemplateEntry, input: PromptInput, result: OpenAIChat[]): void {
	switch (entry.type) {
		case 'instruction':
			if (entry.content) {
				result.push({ role: entry.role, content: entry.content });
			}
			break;
		case 'description': {
			const desc = input.character.data.systemPrompt;
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
			for (const msg of resolveHistorySlice(input.messages, entry.start, entry.end)) {
				result.push({
					role: mapMessageRole(msg.role),
					content: msg.content,
					thought: msg.thought
				});
			}
			break;
	}
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Slice messages array with negative-index support (like Python). */
function resolveHistorySlice(messages: Message[], start: number, end?: number): Message[] {
	const len = messages.length;
	let s = start >= 0 ? start : len + start;
	let e = end === undefined ? len : end >= 0 ? end : len + end;
	if (s < 0) s = 0;
	if (e > len) e = len;
	if (s >= e) return [];
	return messages.slice(s, e);
}

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
