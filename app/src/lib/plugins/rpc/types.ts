/**
 * RPC Protocol Types for Plugin Bridge
 * Standardizes messages sent over the Transport channels for invoking functions.
 */

export interface RPCRequest {
    type: 'rpc_invoke';
    functionId: string;
    args: unknown[];
}

export type RPCResponse =
    | { type: 'rpc_yield'; data: unknown }
    | { type: 'rpc_return'; data: unknown };

// Type guard for requests
export function isRPCRequest(msg: unknown): msg is RPCRequest {
    if (typeof msg !== 'object' || msg === null) return false;
    const obj = msg as Record<string, unknown>;

    return (
        obj.type === 'rpc_invoke' && typeof obj.functionId === 'string' && Array.isArray(obj.args)
    );
}

// Type guard for responses
export function isRPCResponse(msg: unknown): msg is RPCResponse {
    if (typeof msg !== 'object' || msg === null) return false;
    const obj = msg as Record<string, unknown>;

    return obj.type === 'rpc_yield' || obj.type === 'rpc_return';
}
