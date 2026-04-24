export abstract class Transport {
    /** Opens a new channel and sends an OPEN signal to the remote. */
    abstract open(): Channel;
    /** Registers a callback to be invoked when the remote opens a new channel. */
    abstract onChannel(handler: (channel: Channel) => void): void;
    /** Closes all active channels and cleans up transport resources. */
    abstract destroy(): void;
}

export abstract class Channel {
    /** Sends a message to the remote. Use 'transfer' for zero-copy transmission of Transferables. */
    abstract send(data: unknown, transfer?: Transferable[]): void;
    /** Async iterator to receive messages in order. Ends when the channel is closed. */
    abstract [Symbol.asyncIterator](): AsyncIterableIterator<unknown>;
    /** Convenience method to wait for the next single message. */
    abstract receive(): Promise<unknown>;
    /** Gracefully closes the channel and sends a CLOSE signal to the remote. */
    abstract close(): void;
    /** Forcefully terminates the channel and triggers an ABORT signal on the remote. */
    abstract abort(reason?: string): void;
    /** Aborted when the remote closes/aborts the channel or transport keepalive fails. */
    abstract readonly signal: AbortSignal;
    /** Unique channel ID for debugging purposes. */
    abstract readonly id: string;
}

/** Transport-level system messages */
export type SysMessage = { __sys: 'PING' } | { __sys: 'PONG' };

/** Channel-level messages. Mutually exclusive __ctrl and __data. */
export type ChannelMessage =
    | { __ch: string; __ctrl: 'OPEN' }
    | { __ch: string; __ctrl: 'CLOSE' }
    | { __ch: string; __ctrl: 'ABORT'; reason?: string }
    | { __ch: string; __data: unknown };

export type WireMessage = SysMessage | ChannelMessage;
