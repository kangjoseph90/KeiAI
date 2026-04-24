import type { Transport, Channel, WireMessage } from './types';
import { ChannelImpl } from './channel';
import { generateId } from '$lib/utils/id';
import { createLogger } from '$lib/adapters/logger';

const logger = createLogger('plugins:transport');

// ─── Host Transport ─────────────────────────────────────────────────────────

/**
 * Transport for the host (main app) side.
 *
 * Routes incoming postMessages from a specific iframe to the correct Channel
 * by channelId. Each plugin iframe gets its own HostTransport instance.
 */
export class HostTransport implements Transport {
    private iframe: HTMLIFrameElement;
    private channels = new Map<string, ChannelImpl>();
    private channelHandler: ((channel: Channel) => void) | null = null;
    private listener: (event: MessageEvent) => void;
    private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
    private pendingPong = false;

    constructor(iframe: HTMLIFrameElement) {
        this.iframe = iframe;

        this.listener = (event: MessageEvent) => {
            if (event.source !== this.iframe.contentWindow) return;
            this.handleWire(event.data as WireMessage);
        };
        window.addEventListener('message', this.listener);

        // Start keepalive check
        this.startKeepalive();
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
        if (this.keepaliveTimer) {
            clearInterval(this.keepaliveTimer);
            this.keepaliveTimer = null;
        }
        window.removeEventListener('message', this.listener);
        for (const channel of this.channels.values()) {
            channel._handleControl('ABORT', 'Transport destroyed');
        }
        this.channels.clear();
        this.pendingPong = false;
        this.channelHandler = null;
    }

    // ─── Internals ───────────────────────────────────────────────────────

    private createChannel(id: string): ChannelImpl {
        const channel = new ChannelImpl(id, (wire, transfer) => this.post(wire, transfer));
        this.channels.set(id, channel);
        return channel;
    }

    private startKeepalive(): void {
        this.keepaliveTimer = setInterval(() => {
            if (this.pendingPong) {
                logger.warn('Transport keepalive timeout, destroying...');
                this.destroy();
                return;
            }

            this.pendingPong = true;
            this.post({ __sys: 'PING' });
        }, 30_000); // Check every 30s
    }

    private handleWire(wire: WireMessage): void {
        if (!wire || typeof wire !== 'object') return;

        if ('__sys' in wire) {
            if (wire.__sys === 'PONG') {
                this.pendingPong = false;
            }
            return;
        }

        if (!('__ch' in wire)) return;
        const { __ch: channelId } = wire;

        if ('__ctrl' in wire) {
            if (wire.__ctrl === 'OPEN') {
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
            if (channel) {
                channel._handleControl(wire.__ctrl, 'reason' in wire ? wire.reason : undefined);
                if (wire.__ctrl === 'CLOSE' || wire.__ctrl === 'ABORT') {
                    this.channels.delete(channelId);
                }
            }
            return;
        }

        if ('__data' in wire) {
            const channel = this.channels.get(channelId);
            channel?._push(wire.__data);
        }
    }

    private post(wire: WireMessage, transfer?: Transferable[]): void {
        this.iframe.contentWindow?.postMessage(wire, '*', transfer ?? []);
    }
}
