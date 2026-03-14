import { ChatContext } from '../context/chat';
import type { PromptTemplateEntry } from '$lib/services/content/preset';
import type { OpenAIChat } from './types';
import { defaultPresetData } from '$lib/services/content/preset';

export interface PromptBuilderOptions {
	maxTokens?: number;
	includeMemory?: boolean;
}

export class PromptBuilder {
	private ctx: ChatContext;
	private options: PromptBuilderOptions;

	constructor(ctx: ChatContext, options: PromptBuilderOptions = {}) {
		this.ctx = ctx;
		this.options = options;
	}

	async build(): Promise<OpenAIChat[]> {
		const preset = await this.ctx.getPreset();

		// Use default preset structure if none configured
		const templateOrder = preset?.data.templateOrder ?? defaultPresetData.templateOrder;

		const result: OpenAIChat[] = [];

		for (const entry of templateOrder) {
			await this.processEntry(entry, result);
		}

		return result;
	}

	private async processEntry(entry: PromptTemplateEntry, result: OpenAIChat[]): Promise<void> {
		switch (entry.type) {
			case 'instruction':
				await this.processInstruction(entry, result);
				break;
			case 'description':
				await this.processDescription(entry, result);
				break;
			case 'persona':
				await this.processPersona(entry, result);
				break;
			case 'lorebook':
				await this.processLorebook(entry, result);
				break;
			case 'history':
				await this.processHistory(entry, result);
				break;
		}
	}

	private async processInstruction(
		entry: Extract<PromptTemplateEntry, { type: 'instruction' }>,
		result: OpenAIChat[]
	): Promise<void> {
		if (entry.content) {
			result.push({
				role: entry.role,
				content: entry.content
			} as OpenAIChat);
		}
	}

	private async processDescription(
		_entry: Extract<PromptTemplateEntry, { type: 'description' }>,
		result: OpenAIChat[]
	): Promise<void> {
		const character = await this.ctx.getCharacter();
		const description = character.data.systemPrompt;

		if (description) {
			result.push({
				role: 'system',
				content: description
			} as OpenAIChat);
		}
	}

	private async processPersona(
		_entry: Extract<PromptTemplateEntry, { type: 'persona' }>,
		result: OpenAIChat[]
	): Promise<void> {
		const persona = await this.ctx.getPersona();
		if (persona) {
			result.push({
				role: 'system',
				content: persona.description
			} as OpenAIChat);
		}
	}

	private async processLorebook(
		_entry: Extract<PromptTemplateEntry, { type: 'lorebook' }>,
		result: OpenAIChat[]
	): Promise<void> {
		const lorebooks = await this.ctx.getLorebooks();
		const enabledLorebooks = lorebooks.filter((lb) => lb.enabled);

		if (enabledLorebooks.length > 0) {
			const content = enabledLorebooks
				.map((lb) => lb.content)
				.filter(Boolean)
				.join('\n\n');

			if (content) {
				result.push({
					role: 'system',
					content
				} as OpenAIChat);
			}
		}
	}

	private async processHistory(
		entry: Extract<PromptTemplateEntry, { type: 'history' }>,
		result: OpenAIChat[]
	): Promise<void> {
		const messages = await this.ctx.getMessages(entry.start, entry.end);

		for (const msg of messages) {
			result.push({
				role: this.mapMessageRole(msg.role),
				content: msg.content,
				thought: msg.thought
			} as OpenAIChat);
		}
	}

	private mapMessageRole(role: string): 'system' | 'user' | 'assistant' {
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
}

// Convenience function for quick prompt building
export async function buildPrompt(
	ctx: ChatContext,
	options?: PromptBuilderOptions
): Promise<OpenAIChat[]> {
	const builder = new PromptBuilder(ctx, options);
	return builder.build();
}
