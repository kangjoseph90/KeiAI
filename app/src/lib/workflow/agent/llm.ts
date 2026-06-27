import type { LLMStreamContent } from '$lib/llm/types';
import type { LLMTypeDefinition } from '$lib/types/models/llm';
import type { WorkflowDefinition } from '$lib/workflow/types';

export function serializeStreamContent(state: LLMStreamContent): string {
    if (!state.thought?.trim()) return state.content;
    return `<thought>\n${state.thought.trim().replaceAll('</thought>', '<\\/thought>')}\n</thought>\n\n${state.content}`;
}

/**
 * Extracts all LLM types used by Agent nodes in a single workflow.
 */
export function getWorkflowLLMTypes(workflow: WorkflowDefinition | undefined): LLMTypeDefinition[] {
    if (!workflow) return [];

    const agentNames = new Map<string, string[]>();

    for (const node of Object.values(workflow.nodes)) {
        if (node.class !== 'Agent') continue;

        const names = agentNames.get(node.llmType) ?? [];
        if (!names.includes(node.name)) names.push(node.name);
        agentNames.set(node.llmType, names);
    }

    const definitions: LLMTypeDefinition[] = [];
    for (const [type, names] of agentNames) {
        definitions.push({
            type,
            description: `Model used by ${names.join(', ')}`
        });
    }

    return definitions;
}
