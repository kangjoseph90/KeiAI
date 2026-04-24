import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HostTransport } from '$lib/plugins/transport/host';
import { GuestTransport } from '$lib/plugins/transport/guest';
import type { Channel } from '$lib/plugins/transport/types';

describe('Plugin Transport System', () => {
    let port1: MessagePort;
    let port2: MessagePort;
    let hostTransport: HostTransport;
    let guestTransport: GuestTransport;
    let mockIframe: HTMLIFrameElement;

    beforeEach(() => {
        vi.useFakeTimers();
        const channel = new MessageChannel();
        port1 = channel.port1;
        port2 = channel.port2;

        // Mock Host Side
        mockIframe = {
            contentWindow: {
                postMessage: vi.fn((data, _origin, transfer) => {
                    port1.postMessage(data, transfer);
                })
            }
        } as unknown as HTMLIFrameElement;

        // Host listens on window
        const originalAddEventListener = window.addEventListener;
        const originalRemoveEventListener = window.removeEventListener;

        // Intercept messages from port1 to trigger window events for HostTransport
        port1.onmessage = (ev) => {
            const event = new MessageEvent('message', {
                data: ev.data,
                source: mockIframe.contentWindow
            });
            window.dispatchEvent(event);
        };

        hostTransport = new HostTransport(mockIframe);

        // Mock Guest Side
        vi.stubGlobal('parent', {
            postMessage: vi.fn((data, _origin, transfer) => {
                port2.postMessage(data, transfer);
            })
        });

        // Guest listens on window. We need to bridge port2 messages to Guest
        port2.onmessage = (ev) => {
            const event = new MessageEvent('message', {
                data: ev.data,
                source: window.parent // Simulate receiving from parent
            });
            window.dispatchEvent(event);
        };

        guestTransport = new GuestTransport();
    });

    afterEach(() => {
        hostTransport.destroy();
        guestTransport.destroy();
        port1.close();
        port2.close();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('should establish a channel from host to guest', async () => {
        const guestReceivedPromise = new Promise<Channel>((resolve) => {
            guestTransport.onChannel(resolve);
        });

        const hostChannel = hostTransport.open();
        const guestChannel = await guestReceivedPromise;

        expect(guestChannel.id).toBe(hostChannel.id);
    });

    it('should send and receive data bi-directionally', async () => {
        const guestReceivedPromise = new Promise<Channel>((resolve) => {
            guestTransport.onChannel(resolve);
        });

        const hostChannel = hostTransport.open();
        const guestChannel = await guestReceivedPromise;

        // Host -> Guest
        hostChannel.send({ hello: 'guest' });
        const guestMsg = await guestChannel.receive();
        expect(guestMsg).toEqual({ hello: 'guest' });

        // Guest -> Host
        guestChannel.send({ hello: 'host' });
        const hostMsg = await hostChannel.receive();
        expect(hostMsg).toEqual({ hello: 'host' });
    });

    it('should handle async iteration', async () => {
        const guestReceivedPromise = new Promise<Channel>((resolve) => {
            guestTransport.onChannel(resolve);
        });

        const hostChannel = hostTransport.open();
        const guestChannel = await guestReceivedPromise;

        hostChannel.send(1);
        hostChannel.send(2);
        hostChannel.send(3);
        hostChannel.close();

        const received: number[] = [];
        for await (const msg of guestChannel) {
            received.push(msg as number);
        }

        expect(received).toEqual([1, 2, 3]);
    });

    it('should synchronize abort signals', async () => {
        const guestReceivedPromise = new Promise<Channel>((resolve) => {
            guestTransport.onChannel(resolve);
        });

        const hostChannel = hostTransport.open();
        const guestChannel = await guestReceivedPromise;

        const guestAbortPromise = new Promise((resolve) => {
            guestChannel.signal.addEventListener('abort', resolve);
        });

        hostChannel.abort('test-reason');
        await guestAbortPromise;

        expect(guestChannel.signal.aborted).toBe(true);
        expect(guestChannel.signal.reason).toBe('test-reason');
    });

    it('should respond to transport-level PING/PONG', async () => {
        const postSpy = vi.spyOn(hostTransport as unknown as { post: () => void }, 'post');

        // Fast forward 30s
        await vi.advanceTimersByTimeAsync(30_000);

        // Host should have sent PING
        expect(postSpy).toHaveBeenCalledWith(expect.objectContaining({ __sys: 'PING' }));

        // Wait a bit for the async message port bridge to process PONG
        await vi.advanceTimersByTimeAsync(10);

        // pendingPong should be false now
        expect((hostTransport as unknown as { pendingPong: boolean }).pendingPong).toBe(false);
    });

    it('should destroy transport on keepalive timeout', async () => {
        // Prevent guest from responding to PONG by breaking the bridge
        port2.onmessage = null;

        await vi.advanceTimersByTimeAsync(30_000); // Send PING
        expect((hostTransport as unknown as { pendingPong: boolean }).pendingPong).toBe(true);

        await vi.advanceTimersByTimeAsync(30_000); // Check for PONG timeout

        // Transport should be destroyed (keepaliveTimer cleared)
        expect(
            (hostTransport as unknown as { keepaliveTimer: null | number }).keepaliveTimer
        ).toBeNull();
    });
});
