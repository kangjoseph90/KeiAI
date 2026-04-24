import type { Transport, Channel, WireMessage } from './types';
import { ChannelImpl } from './channel';
import { generateId } from '$lib/utils/id';
import { createLogger } from '$lib/adapters/logger';

const logger = createLogger('plugins:transport:guest');

// ─── Guest Transport ────────────────────────────────────────────────────────

/**
 * Transport for the guest (plugin iframe) side.
 *
 * Same routing logic as HostTransport, but posts to `parent` (the host window)
 * instead of an iframe's contentWindow.
 */
export class GuestTransport implements Transport {
    private channels = new Map<string, ChannelImpl>();
    private channelHandler: ((channel: Channel) => void) | null = null;
    private listener: (event: MessageEvent) => void;

    constructor() {
        this.listener = (event: MessageEvent) => {
            // In a sandboxed iframe, parent is the only valid source
            this.handleWire(event.data as WireMessage);
        };
        window.addEventListener('message', this.listener);
    }

    open(): Channel {
        const id = generateId();
        const channel = this.createChannel(id);
        this.post({ __ch: id, __ctrl: 'OPEN' });
        return channel;
    }

    onChannel(handler: (channel: Channel) => void): void {
        this.channelHandler = handler;
    }

    destroy(): void {
        window.removeEventListener('message', this.listener);
        for (const channel of this.channels.values()) {
            channel._handleControl('ABORT', 'Transport destroyed');
        }
        this.channels.clear();
        this.channelHandler = null;
    }

    // ─── Internals ───────────────────────────────────────────────────────

    private createChannel(id: string): ChannelImpl {
        const channel = new ChannelImpl(id, (wire, transfer) => this.post(wire, transfer));
        this.channels.set(id, channel);
        return channel;
    }

    private handleWire(wire: WireMessage): void {
        if (!wire || typeof wire !== 'object') return;

        if ('__sys' in wire) {
            if (wire.__sys === 'PING') {
                this.post({ __sys: 'PONG' });
            }
            return;
        }

        if (!('__ch' in wire)) return;
        const { __ch: channelId } = wire;

        if ('__ctrl' in wire && wire.__ctrl === 'OPEN') {
            const channel = this.createChannel(channelId);
            if (this.channelHandler) {
                this.channelHandler(channel);
            } else {
                logger.warn('Incoming channel but no handler registered');
                channel.abort('No handler');
            }
            return;
        }

        const channel = this.channels.get(channelId);
        if (!channel) return;

        if ('__ctrl' in wire) {
            channel._handleControl(wire.__ctrl, 'reason' in wire ? wire.reason : undefined);
            if (wire.__ctrl === 'CLOSE' || wire.__ctrl === 'ABORT') {
                this.channels.delete(channelId);
            }
            return;
        }

        if ('__data' in wire) {
            channel._push(wire.__data);
        }
    }

    private post(wire: WireMessage, transfer?: Transferable[]): void {
        parent.postMessage(wire, '*', transfer ?? []);
    }
}
