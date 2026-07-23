export type ToolCallStatus = 'pending' | 'running' | 'success' | 'rejected' | 'error';

export type ToolPermission = 'read' | 'write';

export type ToolSchemaPrimitive = 'string' | 'number' | 'boolean';

export interface ToolPropertySchema {
    type: ToolSchemaPrimitive;
    description?: string;
    enum?: Array<string | number | boolean>;
}

export interface ToolInputSchema {
    type: 'object';
    properties: Record<string, ToolPropertySchema>;
    required?: string[];
    additionalProperties?: boolean;
}

export interface ToolDefinition {
    id: string;
    name: string;
    description: string;
    permission: ToolPermission;
    inputSchema: ToolInputSchema;
}

export interface ToolCallRequest {
    callId: string;
    name: string;
    args: Record<string, unknown>;
}

export type ToolCallResponsePart =
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string }
    | { type: 'audio'; data: string; mimeType: string }
    | { type: 'resource'; resource: { uri: string; mimeType: string; text: string } };
