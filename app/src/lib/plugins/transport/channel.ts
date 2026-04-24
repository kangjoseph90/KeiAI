import type { Channel, WireMessage } from './types';

// ─── Channel Implementation ─────────────────────────────────────────────────

/**
 * Bidirectional message channel over postMessage.
 *
 * Created by Transport — never by user code directly.
 * The postFn callback is injected by the owning Transport
 * and handles wire-level delivery (iframe or MessagePort).
 */
export class ChannelImpl implements Channel {
    readonly id: string;
    readonly signal: AbortSignal;

    // ─── Internal State ──────────────────────────────────────────────────
    private controller: AbortController;
    private queue: unknown[];
    private waiter: (() => void) | null;
    private closed: boolean;
    private postFn: (wire: WireMessage, transfer?: Transferable[]) => void;

    constructor(id: string, postFn: (wire: WireMessage, transfer?: Transferable[]) => void) {
        this.id = id;
        this.postFn = postFn;
        this.controller = new AbortController();
        this.signal = this.controller.signal;
        this.queue = [];
        this.waiter = null;
        this.closed = false;
    }

    // ─── Public API ──────────────────────────────────────────────────────

    send(data: unknown, transfer?: Transferable[]): void {
        if (this.closed || this.signal.aborted) return;
        this.postFn({ __ch: this.id, __data: data }, transfer);
    }

    async receive(): Promise<unknown> {
        if (this.queue.length > 0) {
            return this.queue.shift()!;
        }
        if (this.closed || this.signal.aborted) {
            throw new Error('Channel closed');
        }
        // Wait for next _push or _handleControl
        await new Promise<void>((resolve) => {
            this.waiter = resolve;
        });
        if (this.closed || this.signal.aborted) {
            throw new Error('Channel closed');
        }
        return this.queue.shift()!;
    }

    async *[Symbol.asyncIterator](): AsyncIterableIterator<unknown> {
        while (true) {
            // Drain queued messages first
            while (this.queue.length > 0) {
                yield this.queue.shift()!;
            }
            if (this.closed || this.signal.aborted) return;
            // Wait for next message or close
            await new Promise<void>((resolve) => {
                this.waiter = resolve;
            });
        }
    }

    close(): void {
        if (this.closed) return;
        this.closed = true;
        this.postFn({ __ch: this.id, __ctrl: 'CLOSE' });
        this.wake();
    }

    abort(reason?: string): void {
        if (this.closed) return;
        this.closed = true;
        this.postFn({ __ch: this.id, __ctrl: 'ABORT', reason });
        this.controller.abort(reason);
        this.wake();
    }

    // ─── Called by Transport (not for user code) ─────────────────────────

    /** Transport calls this when a DATA message arrives for this channel. */
    _push(data: unknown): void {
        this.queue.push(data);
        this.wake();
    }

    /** Transport calls this when a control message arrives for this channel. */
    _handleControl(ctrl: string, reason?: string): void {
        switch (ctrl) {
            case 'CLOSE':
                this.closed = true;
                this.wake();
                break;
            case 'ABORT':
                this.closed = true;
                this.controller.abort(reason);
                this.wake();
                break;
            // Transport handles keepalive now
        }
    }

    // ─── Helpers ─────────────────────────────────────────────────────────

    private wake(): void {
        if (this.waiter) {
            const w = this.waiter;
            this.waiter = null;
            w();
        }
    }
}
