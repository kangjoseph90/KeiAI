import type { Transport, Channel } from '../transport/types';
import { isRPCRequest, isRPCResponse } from './types';

/**
 * Symmetric RPC Broker.
 * Wraps a Transport to provide bi-directional function exposure and invocation.
 * Both Host and Guest use this exact same class!
 */
export class RPCBroker {
    private registry = new Map<string, (...args: unknown[]) => unknown>();

    constructor(private transport: Transport) {
        // Bind to incoming channels automatically
        this.transport.onChannel(this.handleIncomingChannel.bind(this));
    }

    // ─── Exposure (Listening for calls) ──────────────────────────────────

    /** Registers a function to be callable by the other side. */
    expose(functionId: string, fn: (...args: unknown[]) => unknown): void {
        this.registry.set(functionId, fn);
    }

    unexpose(functionId: string): void {
        this.registry.delete(functionId);
    }

    private async handleIncomingChannel(channel: Channel): Promise<void> {
        try {
            const req = await channel.receive();
            if (!isRPCRequest(req)) {
                channel.abort('Invalid RPC request format');
                return;
            }

            const fn = this.registry.get(req.functionId);
            if (!fn) {
                channel.abort(`Function not exposed: ${req.functionId}`);
                return;
            }

            // Execute the function
            const result = await fn(...req.args);

            // Check if result is an async iterable (e.g., streaming)
            if (
                result !== null &&
                typeof result === 'object' &&
                Symbol.asyncIterator in result &&
                typeof (result as Record<symbol, unknown>)[Symbol.asyncIterator] === 'function'
            ) {
                const iterator = result as AsyncIterable<unknown>;
                for await (const chunk of iterator) {
                    channel.send({ type: 'rpc_yield', data: chunk });
                }
                channel.send({ type: 'rpc_return', data: undefined });
            } else {
                // Normal return value
                channel.send({ type: 'rpc_return', data: result });
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            channel.abort(`RPC Execution Error: ${message}`);
        } finally {
            channel.close();
        }
    }

    // ─── Invocation (Calling the other side) ─────────────────────────────

    /** Invokes a remote function and waits for a single return value. */
    async invoke<T = unknown>(functionId: string, args: unknown[]): Promise<T> {
        const channel = this.transport.open();

        try {
            channel.send({ type: 'rpc_invoke', functionId, args });
            const result = await channel.receive();

            if (!isRPCResponse(result)) {
                throw new Error(`Invalid RPC response for ${functionId}`);
            }

            if (result.type === 'rpc_return') {
                return result.data as T;
            }

            throw new Error(`Expected rpc_return but got ${result.type}`);
        } finally {
            channel.close();
        }
    }

    /** Invokes a remote AsyncGenerator and yields streamed responses. */
    async *invokeStream<T = unknown>(
        functionId: string,
        args: unknown[],
        signal?: AbortSignal
    ): AsyncGenerator<T> {
        const channel = this.transport.open();

        if (signal) {
            const onAbort = () => channel.abort(signal.reason);
            signal.addEventListener('abort', onAbort, { once: true });

            channel.signal.addEventListener(
                'abort',
                () => {
                    signal.removeEventListener('abort', onAbort);
                },
                { once: true }
            );
        }

        try {
            channel.send({ type: 'rpc_invoke', functionId, args });

            for await (const msg of channel) {
                if (!isRPCResponse(msg)) {
                    throw new Error(`Invalid RPC stream response for ${functionId}`);
                }

                if (msg.type === 'rpc_yield') {
                    yield msg.data as T;
                } else if (msg.type === 'rpc_return') {
                    return msg.data as T;
                }
            }
        } finally {
            channel.close();
        }
    }

    /** Invokes a remote function without waiting for its return value. */
    fireEvent(functionId: string, args: unknown[]): void {
        const channel = this.transport.open();
        channel.send({ type: 'rpc_invoke', functionId, args });
    }
}
