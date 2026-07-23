import type { RuntimeContext } from '$lib/types/context';
import { AppError } from '$lib/types/errors';
import type { ToolCallResponsePart, ToolDefinition, ToolPropertySchema } from '$lib/types/tools';
import type { FileNamespace } from '../types';
import { readWorkflowFile, writeWorkflowFile } from '../file/operations';

export interface AgentToolDefinition extends ToolDefinition {
    label: string;
    execute(
        args: Record<string, unknown>,
        ctx: ToolExecutionContext
    ): Promise<ToolCallResponsePart[]>;
}

interface ToolExecutionContext {
    runtime: RuntimeContext;
    signal: AbortSignal;
}

const FILE_NAMESPACE_SCHEMA: ToolPropertySchema = {
    type: 'string',
    description: 'Application file namespace.',
    enum: ['global', 'room', 'chat']
};

export const FILE_READ_TOOL: AgentToolDefinition = {
    id: 'file_read',
    name: 'file_read',
    label: 'File Read',
    description: 'Read a text file from the application global, room, or chat file namespace.',
    permission: 'read',
    inputSchema: {
        type: 'object',
        properties: {
            namespace: FILE_NAMESPACE_SCHEMA,
            path: { type: 'string', description: 'File path within the selected namespace.' }
        },
        required: ['namespace', 'path'],
        additionalProperties: false
    },
    async execute(args, { runtime, signal }) {
        throwIfAborted(signal);
        const namespace = requireFileNamespace(args.namespace);
        const path = requireString(args.path, 'path');
        const file = await readWorkflowFile(namespace, path, runtime);
        throwIfAborted(signal);
        return [{ type: 'text', text: file.content }];
    }
};

export const FILE_WRITE_TOOL: AgentToolDefinition = {
    id: 'file_write',
    name: 'file_write',
    label: 'File Write',
    description: 'Create or overwrite a text file in an application file namespace.',
    permission: 'write',
    inputSchema: {
        type: 'object',
        properties: {
            namespace: FILE_NAMESPACE_SCHEMA,
            path: { type: 'string', description: 'File path within the selected namespace.' },
            content: { type: 'string', description: 'Complete text content to write.' }
        },
        required: ['namespace', 'path', 'content'],
        additionalProperties: false
    },
    async execute(args, { runtime, signal }) {
        throwIfAborted(signal);
        const namespace = requireFileNamespace(args.namespace);
        const path = requireString(args.path, 'path');
        const content = requireString(args.content, 'content');
        const result = await writeWorkflowFile(namespace, path, content, runtime);
        throwIfAborted(signal);
        return [
            {
                type: 'text',
                text: `${result.created ? 'Created' : 'Updated'} ${namespace}:${result.file.path}`
            }
        ];
    }
};

export const AGENT_TOOL_REGISTRY = {
    file_read: FILE_READ_TOOL,
    file_write: FILE_WRITE_TOOL
} satisfies Record<string, AgentToolDefinition>;

export type BuiltInAgentToolId = keyof typeof AGENT_TOOL_REGISTRY;

export function listAgentTools(): AgentToolDefinition[] {
    return Object.values(AGENT_TOOL_REGISTRY);
}

export function resolveAgentTools(toolIds: readonly string[]): AgentToolDefinition[] {
    return toolIds.map((id) => requireAgentTool(id));
}

export function requireAgentTool(idOrName: string): AgentToolDefinition {
    const direct = AGENT_TOOL_REGISTRY[idOrName as BuiltInAgentToolId];
    const tool = direct ?? listAgentTools().find((candidate) => candidate.name === idOrName);
    if (!tool) throw new AppError('INVALID_INPUT', `Unknown agent tool: ${idOrName}`);
    return tool;
}

export function validateToolArguments(tool: ToolDefinition, args: Record<string, unknown>): void {
    const { properties, required = [], additionalProperties = true } = tool.inputSchema;
    for (const field of required) {
        if (!(field in args)) {
            throw new AppError('INVALID_INPUT', `Missing argument for ${tool.name}: ${field}`);
        }
    }
    if (!additionalProperties) {
        for (const field of Object.keys(args)) {
            if (!(field in properties)) {
                throw new AppError('INVALID_INPUT', `Unknown argument for ${tool.name}: ${field}`);
            }
        }
    }
    for (const [field, value] of Object.entries(args)) {
        const schema = properties[field];
        if (!schema) continue;
        if (typeof value !== schema.type) {
            throw new AppError('INVALID_INPUT', `Invalid ${tool.name} argument type: ${field}`);
        }
        if (schema.enum && !schema.enum.includes(value as string | number | boolean)) {
            throw new AppError('INVALID_INPUT', `Invalid ${tool.name} argument value: ${field}`);
        }
    }
}

export function getToolRuntimeContext(
    runtime: RuntimeContext,
    signal: AbortSignal
): ToolExecutionContext {
    return { runtime, signal };
}

function requireString(value: unknown, field: string): string {
    if (typeof value !== 'string') {
        throw new AppError('INVALID_INPUT', `Tool argument must be a string: ${field}`);
    }
    return value;
}

function requireFileNamespace(value: unknown): FileNamespace {
    if (value === 'global' || value === 'room' || value === 'chat') return value;
    throw new AppError('INVALID_INPUT', 'Tool argument must be a valid namespace');
}

function throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) throw new DOMException('Operation aborted', 'AbortError');
}
