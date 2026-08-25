import type { LLMContentPart, LLMMessage, LLMTextPart } from '$lib/llm/types';
import { AssetService } from '$lib/services/asset';
import type { Chat } from '$lib/services/content/chat';
import { ToolCallService } from '$lib/services/content/tool';
import { toBase64 } from '$lib/crypto';
import { getAssetMediaType } from '$lib/types/asset';
import type { ToolCallStatus } from '$lib/types/tools';
import type { LLMRole, LLMTypeDefinition } from '$lib/types/models/llm';
import type { WorkflowDefinition } from '$lib/workflow/types';
import { fileBytesToLLMPart } from '$lib/llm/attachments';

export type AgentTextPart = { type: 'text'; text: string };
export type AgentToolCall = { id: string; name: string; status: ToolCallStatus };

export type AgentPart =
    | AgentTextPart
    | { type: 'thought'; text: string }
    | { type: 'inlay'; ids: string[] }
    | { type: 'tool_calls'; calls: AgentToolCall[] };

export function serializeAgentParts(parts: AgentPart[]): string {
    return parts
        .map((part) => {
            switch (part.type) {
                case 'thought':
                    return `<|thought|>${escapeAgentText(part.text)}<|/thought|>`;
                case 'text':
                    return escapeAgentText(part.text);
                case 'inlay':
                    return `<|inlay|>${escapeAgentText(JSON.stringify(part.ids))}<|/inlay|>`;
                case 'tool_calls':
                    return `<|tool_calls|>${escapeAgentText(JSON.stringify(part.calls))}<|/tool_calls|>`;
                default:
                    return '';
            }
        })
        .join('');
}

export function deserializeAgentParts(serialized: string): AgentPart[] {
    const parts: AgentPart[] = [];
    const regex =
        /(<\|thought\|>([\s\S]*?)<\|\/thought\|>)|(<\|inlay\|>([\s\S]*?)<\|\/inlay\|>)|(<\|tool_calls\|>([\s\S]*?)<\|\/tool_calls\|>)/g;

    let lastIndex = 0;
    let match;

    while ((match = regex.exec(serialized)) !== null) {
        const matchIndex = match.index;

        if (matchIndex > lastIndex) {
            const text = serialized.substring(lastIndex, matchIndex);
            if (text) {
                parts.push({ type: 'text', text: unescapeAgentText(text) });
            }
        }

        if (match[1]) {
            const text = match[2] ?? '';
            parts.push({ type: 'thought', text: unescapeAgentText(text) });
        } else if (match[3]) {
            const ids = parseInlayIds(unescapeAgentText(match[4] ?? ''));
            if (ids) parts.push({ type: 'inlay', ids });
        } else if (match[5]) {
            const calls = parseToolCalls(unescapeAgentText(match[6] ?? ''));
            if (calls) parts.push({ type: 'tool_calls', calls });
        }

        lastIndex = regex.lastIndex;
    }

    if (lastIndex < serialized.length) {
        const text = serialized.substring(lastIndex);
        if (text) {
            parts.push({ type: 'text', text: unescapeAgentText(text) });
        }
    }

    return parts;
}

export async function agentPartsToLLMMessages(
    parts: AgentPart[],
    role: LLMRole,
    chat: Chat
): Promise<LLMMessage[]> {
    const messages: LLMMessage[] = [];
    const append = (partRole: LLMRole, content: LLMContentPart[]): void => {
        if (content.length === 0) return;
        const last = messages.at(-1);
        if (last?.role === partRole) {
            last.content.push(...content);
        } else {
            messages.push({ role: partRole, content });
        }
    };

    for (const part of parts) {
        switch (part.type) {
            case 'text':
                append(role, [{ type: 'text', text: part.text }]);
                break;
            case 'thought':
                append(role, [{ type: 'thought', text: part.text }]);
                break;
            case 'inlay':
                append(role, await loadInlayContent(part.ids, chat));
                break;
            case 'tool_calls': {
                const loaded = await Promise.all(
                    part.calls.map(async (call) => ({
                        call,
                        record: await ToolCallService.get(call.id)
                    }))
                );
                const requests: LLMContentPart[] = [];
                const responses: LLMContentPart[] = [];

                for (const { call, record } of loaded) {
                    if (!record) {
                        requests.push({
                            type: 'text',
                            text: `[Tool call: ${call.name} — ${call.status}; details unavailable]`
                        });
                        continue;
                    }
                    requests.push({
                        type: 'tool_request',
                        callId: record.call.callId,
                        name: record.call.name,
                        args: record.call.args
                    });
                    if (record.response) {
                        responses.push({
                            type: 'tool_response',
                            callId: record.call.callId,
                            name: record.call.name,
                            content: record.response,
                            ...(record.status === 'error' || record.status === 'rejected'
                                ? { isError: true }
                                : {})
                        });
                    }
                }

                append('assistant', requests);
                append('user', responses);
                break;
            }
        }
    }
    return messages;
}

/** Text of the last Agent text part. */
export function getTextContent(content: LLMContentPart[]): string {
    return content
        .filter((part): part is LLMTextPart => part.type === 'text')
        .map((part) => part.text)
        .join('');
}

export function getLastTextContent(parts: AgentPart[]): string {
    return getLastTextPart(parts)?.text ?? '';
}

export function getLastTextPart(parts: AgentPart[]): AgentTextPart | undefined {
    const index = findLastTextIndex(parts);
    if (index < 0) return undefined;
    const part = parts[index];
    return part.type === 'text' ? part : undefined;
}

/** Index of the last text part, or -1 if none. */
export function findLastTextIndex(parts: AgentPart[]): number {
    for (let i = parts.length - 1; i >= 0; i -= 1) {
        if (parts[i].type === 'text') return i;
    }
    return -1;
}

export function hasVisibleAgentOutput(parts: AgentPart[]): boolean {
    return parts.some(
        (part) =>
            (part.type === 'text' && part.text.trim().length > 0) ||
            (part.type === 'inlay' && part.ids.length > 0)
    );
}

export function findVisibleStartIndex(parts: AgentPart[]): number {
    const lastTextIndex = findLastTextIndex(parts);
    if (lastTextIndex < 0) {
        let start = parts.length;
        while (start > 0 && parts[start - 1].type === 'inlay') start -= 1;
        return start;
    }

    let start = lastTextIndex;
    while (start > 0 && parts[start - 1].type === 'inlay') start -= 1;
    return start;
}

export function getVisibleParts(parts: AgentPart[]): AgentPart[] {
    return parts.slice(findVisibleStartIndex(parts));
}

export async function loadInlayContent(ids: string[], chat: Chat): Promise<LLMContentPart[]> {
    const parts: LLMContentPart[] = [];
    for (const id of ids) {
        const ref = chat.inlays.refs[id];
        if (!ref) continue;

        const locator = {
            scopeType: chat.scopeType,
            scopeId: chat.scopeId,
            ownerTable: 'chats',
            ownerId: chat.id,
            hash: ref.hash
        } as const;
        let bytes = await AssetService.readBytes(locator);
        if (!bytes && (await AssetService.load({ ...locator, encKey: ref.encKey }))) {
            bytes = await AssetService.readBytes(locator);
        }
        if (!bytes) continue;

        const mediaType = getAssetMediaType(ref.mimeType);
        if (mediaType === 'other') {
            parts.push(fileBytesToLLMPart(ref.name, ref.mimeType, bytes));
            continue;
        }
        parts.push({
            type: mediaType,
            mimeType: ref.mimeType,
            data: toBase64(new Uint8Array(bytes))
        });
    }
    return parts;
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
            agentNames: names,
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

function parseInlayIds(value: string): string[] | null {
    try {
        const parsed: unknown = JSON.parse(value);
        if (!Array.isArray(parsed) || !parsed.every((id) => typeof id === 'string')) return null;
        return parsed;
    } catch {
        return null;
    }
}

function parseToolCalls(value: string): AgentToolCall[] | null {
    try {
        const parsed: unknown = JSON.parse(value);
        if (!Array.isArray(parsed)) return null;

        const calls: AgentToolCall[] = [];
        for (const item of parsed) {
            if (!item || typeof item !== 'object') return null;
            const record = item as Record<string, unknown>;
            if (
                typeof record.id !== 'string' ||
                typeof record.name !== 'string' ||
                !isToolCallStatus(record.status)
            ) {
                return null;
            }
            calls.push({ id: record.id, name: record.name, status: record.status });
        }
        return calls;
    } catch {
        return null;
    }
}

function isToolCallStatus(value: unknown): value is ToolCallStatus {
    return (
        value === 'pending' ||
        value === 'running' ||
        value === 'success' ||
        value === 'error' ||
        value === 'rejected'
    );
}
