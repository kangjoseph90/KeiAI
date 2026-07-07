import type { LLMStreamContent, OpenAIChat } from '$lib/llm/types';
import type { ToolCallStatus } from '$lib/services/content/tool';
import type { LLMTypeDefinition } from '$lib/types/models/llm';
import type { WorkflowDefinition } from '$lib/workflow/types';

export type AgentPart =
    | { type: 'thought'; text: string }
    | { type: 'content'; text: string }
    | { type: 'tool_call'; id: string; name: string; status: ToolCallStatus };

export function serializeAgentParts(parts: AgentPart[]): string {
    return parts
        .map((part) => {
            switch (part.type) {
                case 'thought':
                    return `<|thought|>${escapeAgentText(part.text)}<|/thought|>`;
                case 'content':
                    return escapeAgentText(part.text);
                case 'tool_call':
                    return `<|tool_call id="${part.id}" name="${part.name}" status="${part.status}"|>`;
                default:
                    return '';
            }
        })
        .join('');
}

export function deserializeAgentParts(serialized: string): AgentPart[] {
    const parts: AgentPart[] = [];
    const regex =
        /(<\|thought\|>([\s\S]*?)<\|\/thought\|>)|(<\|tool_call id="([^"]+)" name="([^"]+)" status="([^"]+)"\|>)/g;

    let lastIndex = 0;
    let match;

    while ((match = regex.exec(serialized)) !== null) {
        const matchIndex = match.index;

        if (matchIndex > lastIndex) {
            const text = serialized.substring(lastIndex, matchIndex);
            if (text) {
                parts.push({ type: 'content', text: unescapeAgentText(text) });
            }
        }

        if (match[1]) {
            const text = match[2] ?? '';
            parts.push({ type: 'thought', text: unescapeAgentText(text) });
        } else if (match[3]) {
            const id = match[4];
            const name = match[5];
            const status = match[6] as ToolCallStatus;
            parts.push({ type: 'tool_call', id, name, status });
        }

        lastIndex = regex.lastIndex;
    }

    if (lastIndex < serialized.length) {
        const text = serialized.substring(lastIndex);
        if (text) {
            parts.push({ type: 'content', text: unescapeAgentText(text) });
        }
    }

    return parts;
}

export function agentPartsToOpenAIChats(parts: AgentPart[]): OpenAIChat[] {
    const messages: OpenAIChat[] = [];
    let content = '';

    for (const part of parts) {
        switch (part.type) {
            case 'content':
                content += part.text;
                break;
            case 'thought':
                break;
            case 'tool_call':
                // TODO: Convert tool call records and mock tool responses into provider tool messages
                // once LLM handlers expose tool-call request/response semantics.
                break;
        }
    }

    if (content) {
        messages.push({ role: 'assistant', content });
    }
    return messages;
}

/** Text of the last content part — the user-facing answer of a completed message. */
export function getLastContentText(parts: AgentPart[]): string {
    const idx = findLastContentIndex(parts);
    return idx >= 0 ? (parts[idx] as { text: string }).text : '';
}

/** Index of the last content part, or -1 if none. */
export function findLastContentIndex(parts: AgentPart[]): number {
    for (let i = parts.length - 1; i >= 0; i -= 1) {
        if (parts[i].type === 'content') return i;
    }
    return -1;
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

function escapeAgentText(text: string): string {
    return text.replaceAll('&', '&amp;').replaceAll('<|', '&lt;|');
}

function unescapeAgentText(text: string): string {
    return text.replaceAll('&lt;|', '<|').replaceAll('&amp;', '&');
}
