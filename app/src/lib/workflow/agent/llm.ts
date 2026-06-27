import type { LLMStreamContent } from '$lib/llm/types';

export function serializeStreamContent(state: LLMStreamContent): string {
    if (!state.thought?.trim()) return state.content;
    return `<thought>\n${state.thought.trim().replaceAll('</thought>', '<\\/thought>')}\n</thought>\n\n${state.content}`;
}
