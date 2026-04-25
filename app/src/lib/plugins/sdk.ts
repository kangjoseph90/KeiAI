export const guestSDK = String.raw`
class GuestTransport {
    constructor() {
        this.channels = new Map();
        this.nextId = 1;
        this.handler = null;
        window.addEventListener('message', this.onMsg.bind(this));
    }

    onMsg(event) {
        if (event.source !== parent) return;
        const wire = event.data;
        if (!wire || typeof wire !== 'object') return;

        if (wire.__sys === 'PING') {
            parent.postMessage({ __sys: 'PONG' }, '*');
            return;
        }

        if (!wire.__ch) return;

        if (wire.__ctrl === 'OPEN') {
            const channel = this.createChannel(wire.__ch);
            if (this.handler) this.handler(channel);
            else channel.abort('No handler');
            return;
        }

        const channel = this.channels.get(wire.__ch);
        if (!channel) return;

        if (wire.__ctrl) {
            channel._ctrl(wire.__ctrl, wire.reason);
            return;
        }

        if ('__data' in wire) {
            channel._data(wire.__data);
        }
    }

    open() {
        const id = 'ch_' + Date.now() + '_' + this.nextId++;
        const channel = this.createChannel(id);
        parent.postMessage({ __ch: id, __ctrl: 'OPEN' }, '*');
        return channel;
    }

    createChannel(id) {
        const ac = new AbortController();
        const channel = {
            id,
            closed: false,
            queue: [],
            resolveNext: null,
            signal: ac.signal,
            send: (data, transfer) => {
                if (!channel.closed) parent.postMessage({ __ch: id, __data: data }, '*', transfer);
            },
            receive: async () => {
                if (channel.queue.length > 0) return channel.queue.shift();
                if (channel.closed) throw new Error('Channel closed');
                return new Promise((resolve) => {
                    channel.resolveNext = resolve;
                });
            },
            close: () => {
                if (channel.closed) return;
                channel.closed = true;
                parent.postMessage({ __ch: id, __ctrl: 'CLOSE' }, '*');
                if (channel.resolveNext) channel.resolveNext(undefined);
            },
            abort: (reason) => {
                if (channel.closed) return;
                channel.closed = true;
                ac.abort(reason);
                parent.postMessage({ __ch: id, __ctrl: 'ABORT', reason }, '*');
                if (channel.resolveNext) channel.resolveNext(undefined);
            },
            _ctrl: (cmd, reason) => {
                channel.closed = true;
                if (cmd === 'ABORT') ac.abort(reason);
                if (channel.resolveNext) channel.resolveNext(undefined);
            },
            _data: (data) => {
                if (channel.resolveNext) {
                    const resolve = channel.resolveNext;
                    channel.resolveNext = null;
                    resolve(data);
                } else {
                    channel.queue.push(data);
                }
            },
            [Symbol.asyncIterator]: async function* () {
                while (!channel.closed || channel.queue.length > 0) {
                    const value = await channel.receive();
                    if (value !== undefined) yield value;
                }
            }
        };

        this.channels.set(id, channel);
        return channel;
    }

    onChannel(handler) {
        this.handler = handler;
    }
}

class RPCBroker {
    constructor(transport) {
        this.transport = transport;
        this.registry = new Map();
        transport.onChannel(this.onChannel.bind(this));
    }

    expose(id, fn) {
        this.registry.set(id, fn);
    }

    async onChannel(channel) {
        try {
            const request = await channel.receive();
            if (!request || request.type !== 'rpc_invoke') {
                channel.abort('Invalid request');
                return;
            }

            const fn = this.registry.get(request.functionId);
            if (!fn) {
                channel.abort('Not found');
                return;
            }

            const result = await fn(...request.args);
            if (result && typeof result[Symbol.asyncIterator] === 'function') {
                for await (const chunk of result) {
                    channel.send({ type: 'rpc_yield', data: chunk });
                }
                channel.send({ type: 'rpc_return', data: undefined });
            } else {
                channel.send({ type: 'rpc_return', data: result });
            }
        } catch (error) {
            channel.abort(error instanceof Error ? error.message : String(error));
        } finally {
            channel.close();
        }
    }

    async invoke(id, args) {
        const channel = this.transport.open();
        try {
            channel.send({ type: 'rpc_invoke', functionId: id, args });
            const response = await channel.receive();
            if (!response || response.type !== 'rpc_return') throw new Error('Invalid response');
            return response.data;
        } finally {
            channel.close();
        }
    }

    fire(id, args) {
        const channel = this.transport.open();
        channel.send({ type: 'rpc_invoke', functionId: id, args });
    }
}

const broker = new RPCBroker(new GuestTransport());
const registrations = [];

window.KeiAPI = {
    log: (...args) => broker.fire('core.log', args),
    getArg: (key) => broker.invoke('core.getArg', [key]),
    setArg: (key, value) => broker.invoke('core.setArg', [key, value]),
    onPipeline: (phase, fn, opts = {}) => {
        const fnId = 'pipe_' + Date.now() + '_' + Math.random();
        broker.expose(fnId, fn);
        const registration = broker.invoke('core.onPipeline', [phase, fnId, opts.order || 100]);
        registrations.push(registration);
        return registration;
    },
    onEvent: (event, fn) => {
        const fnId = 'evt_' + Date.now() + '_' + Math.random();
        broker.expose(fnId, fn);
        const registration = broker.invoke('core.onEvent', [event, fnId]);
        registrations.push(registration);
        return registration;
    },
    onUnload: (fn) => {
        const fnId = 'unload_' + Date.now() + '_' + Math.random();
        broker.expose(fnId, fn);
        const registration = broker.invoke('core.onUnload', [fnId]);
        registrations.push(registration);
        return registration;
    },
    emitEvent: (chatId, event, data) => broker.fire('core.emitEvent', [chatId, event, data])
};

window.__KeiPluginBootDone = async () => {
    const results = await Promise.allSettled(registrations);
    const rejected = results.find((result) => result.status === 'rejected');
    if (rejected) {
        await broker.invoke('core.ready', [false, String(rejected.reason)]);
        return;
    }
    await broker.invoke('core.ready', [true]);
};

window.__KeiPluginBootFailed = async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    await broker.invoke('core.ready', [false, message]);
};
`;
