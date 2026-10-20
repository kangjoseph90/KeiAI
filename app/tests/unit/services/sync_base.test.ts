import { afterEach, describe, expect, it, vi } from 'vitest';
import { BaseRecordSyncEngine } from '$lib/services/sync/base';

function gate() {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => {
        release = resolve;
    });
    return { promise, release };
}

class Engine extends BaseRecordSyncEngine<string> {
    readonly sync = vi.fn(async () => {});
    readonly push = vi.fn(async () => {});

    constructor() {
        super(undefined, 1);
    }
    protected syncRecords() {
        return this.sync();
    }
    protected getBufferedWrites(id: string) {
        return [{ bucket: 'records', id }];
    }
    protected pushBufferedWrites() {
        return this.push();
    }
    realtime(operation: () => Promise<void>) {
        return this.runBackground(operation);
    }
}

describe('record sync stop barrier', () => {
    afterEach(() => vi.useRealTimers());

    it('drains an active sync and refuses new work until resumed', async () => {
        const engine = new Engine();
        const sync = gate();
        engine.sync.mockImplementationOnce(() => sync.promise);
        const running = engine.trigger();
        const stopped = vi.fn();
        const stopping = engine.stop().then(stopped);
        await engine.trigger();
        engine.handleLocalWrite('late');
        await Promise.resolve();
        expect(stopped).not.toHaveBeenCalled();
        sync.release();
        await Promise.all([running, stopping]);
        expect(engine.sync).toHaveBeenCalledTimes(1);
        expect(engine.push).not.toHaveBeenCalled();
        engine.resume();
        await engine.trigger();
        expect(engine.sync).toHaveBeenCalledTimes(2);
    });

    it('drains both a buffered push and a Realtime repair, rejecting late events', async () => {
        vi.useFakeTimers();
        const engine = new Engine();
        const push = gate();
        const realtime = gate();
        const repair = gate();
        engine.push.mockImplementationOnce(() => push.promise);
        engine.handleLocalWrite('pending');
        await vi.advanceTimersByTimeAsync(1);
        const event = engine.realtime(async () => {
            void engine.realtime(() => repair.promise);
            await realtime.promise;
        });
        const stopped = vi.fn();
        const stopping = engine.stop().then(stopped);
        const lateEvent = vi.fn(async () => {});
        await engine.realtime(lateEvent);
        expect(lateEvent).not.toHaveBeenCalled();
        push.release();
        realtime.release();
        await event;
        expect(stopped).not.toHaveBeenCalled();
        repair.release();
        await stopping;
        expect(stopped).toHaveBeenCalledOnce();
    });
});
