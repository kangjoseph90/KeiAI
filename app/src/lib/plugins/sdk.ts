export const guestSDK = String.raw`
(function() {
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
    
        unexpose(id) {
            this.registry.delete(id);
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
    
                const result = await fn(...request.args, channel.signal);
                if (result && typeof result[Symbol.asyncIterator] === 'function') {
                    for await (const chunk of result) {
                        channel.send({ type: 'rpc_yield', data: chunk });
                    }
                    channel.send({ type: 'rpc_return', data: undefined });
                } else {
                    channel.send({ type: 'rpc_return', data: result });
                }
            } catch (error) {
                const errObj = error instanceof Error
                    ? { name: error.name, message: error.message, stack: error.stack }
                    : { name: 'Error', message: String(error) };
                channel.send({ type: 'rpc_error', error: errObj });
            } finally {
                channel.close();
            }
        }
    
        async invoke(id, args, signal) {
            const channel = this.transport.open();
            const onAbort = () => channel.abort(signal.reason);

            if (signal) {
                if (signal.aborted) {
                    channel.abort(signal.reason);
                } else {
                    signal.addEventListener('abort', onAbort, { once: true });
                }
            }

            try {
                channel.send({ type: 'rpc_invoke', functionId: id, args });
                for await (const response of channel) {
                    if (!response) continue;
                    if (response.type === 'rpc_return') {
                        return response.data;
                    }
                    if (response.type === 'rpc_error') {
                        const err = new Error(response.error?.message || 'Plugin RPC error');
                        err.name = response.error?.name || 'Error';
                        err.stack = response.error?.stack;
                        throw err;
                    }
                    if (response.type !== 'rpc_yield') {
                        throw new Error('Invalid response');
                    }
                }
                throw new Error('Channel closed before response');
            } finally {
                if (signal) signal.removeEventListener('abort', onAbort);
                channel.close();
            }
        }

        async *invokeStream(id, args, signal) {
            const channel = this.transport.open();
            const onAbort = () => channel.abort(signal.reason);

            if (signal) {
                if (signal.aborted) {
                    channel.abort(signal.reason);
                } else {
                    signal.addEventListener('abort', onAbort, { once: true });
                }
            }

            try {
                channel.send({ type: 'rpc_invoke', functionId: id, args });

                for await (const response of channel) {
                    if (!response) continue;
                    if (response.type === 'rpc_yield') {
                        yield response.data;
                    } else if (response.type === 'rpc_return') {
                        return response.data;
                    } else if (response.type === 'rpc_error') {
                        const err = new Error(response.error?.message || 'Plugin RPC error');
                        err.name = response.error?.name || 'Error';
                        err.stack = response.error?.stack;
                        throw err;
                    } else {
                        throw new Error('Invalid stream response');
                    }
                }
            } finally {
                if (signal) signal.removeEventListener('abort', onAbort);
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
    const activeMacros = new Map();

    window.KeiAPI = {
        log: (...args) => broker.fire('core.log', args),
        getArg: (key) => broker.invoke('core.getArg', [key]),
        setArg: (key, value) => broker.invoke('core.setArg', [key, value]),
        onPipeline: (phase, fn, opts = {}) => {
            const fnId = 'pipe_' + Date.now() + '_' + Math.random();
            broker.expose(fnId, fn);
            const p = broker.invoke('core.onPipeline', [phase, fnId, opts.order || 100]);
            registrations.push(p);
            return async () => {
                try {
                    await broker.invoke('core.offPipeline', [phase, fnId]);
                } catch (e) {
                    // Ignore transport errors during unload/off
                } finally {
                    broker.unexpose(fnId);
                }
            };
        },
        onEvent: (event, fn) => {
            const fnId = 'evt_' + Date.now() + '_' + Math.random();
            broker.expose(fnId, fn);
            const p = broker.invoke('core.onEvent', [event, fnId]);
            registrations.push(p);
            return async () => {
                try {
                    await broker.invoke('core.offEvent', [event, fnId]);
                } catch (e) {
                    // Ignore transport errors during unload/off
                } finally {
                    broker.unexpose(fnId);
                }
            };
        },
        registerMacro: (name, fn, opts = {}) => {
            const oldFnId = activeMacros.get(name);
            if (oldFnId) broker.unexpose(oldFnId);
    
            const fnId = 'macro_' + Date.now() + '_' + Math.random();
            activeMacros.set(name, fnId);
    
            broker.expose(fnId, fn);
            const p = broker.invoke('core.registerMacro', [name, fnId, opts.recursive]);
            registrations.push(p);
            return async () => {
                try {
                    await broker.invoke('core.offMacro', [name, fnId]);
                } catch (e) {
                    // Ignore transport errors during unload/off
                } finally {
                    if (activeMacros.get(name) === fnId) activeMacros.delete(name);
                    broker.unexpose(fnId);
                }
            };
        },
        onUnload: (fn) => {
            const fnId = 'unload_' + Date.now() + '_' + Math.random();
            broker.expose(fnId, fn);
            const p = broker.invoke('core.onUnload', [fnId]);
            registrations.push(p);
        },
        emitEvent: (chatId, event, data) => broker.fire('core.emitEvent', [chatId, event, data]),
        getRoom: (roomId) => broker.invoke('core.getRoom', [roomId]),
        getChat: (chatId) => broker.invoke('core.getChat', [chatId]),
        getMessage: (messageId) => broker.invoke('core.getMessage', [messageId]),
        listInlays: (chatId) => broker.invoke('core.listInlays', [chatId]),
        readInlay: (chatId, inlayId) => broker.invoke('core.readInlay', [chatId, inlayId]),
        createInlay: (chatId, input) => broker.invoke('core.createInlay', [chatId, input]),
        addLLMProvider: (modelId, fn, opts = {}) => {
            const fnId = 'llm_' + Date.now() + '_' + Math.random();
            broker.expose(fnId, (messages, config, signal) => {
                return fn(messages, signal, config);
            });
            const p = broker.invoke('core.addLLMProvider', [modelId, fnId, { tokenizer: opts.tokenizer, name: opts.name, unsupported: opts.unsupported }]);
            registrations.push(p);
            return async () => {
                try {
                    await broker.invoke('core.removeLLMProvider', [modelId, fnId]);
                } catch (e) {
                    // Ignore transport errors during unload
                } finally {
                    broker.unexpose(fnId);
                }
            };
        },
        addImageGenProvider: (modelId, fn, opts = {}) => {
            const fnId = 'imagegen_' + Date.now() + '_' + Math.random();
            broker.expose(fnId, fn);
            const registration = broker.invoke('core.addImageGenProvider', [
                modelId,
                fnId,
                { name: opts.name }
            ]);
            registrations.push(registration);
            return async () => {
                try {
                    await broker.invoke('core.removeImageGenProvider', [modelId, fnId]);
                } catch (e) {
                    // Ignore transport errors during unload
                } finally {
                    broker.unexpose(fnId);
                }
            };
        },
        addTTSProvider: (modelId, fn, opts = {}) => {
            const fnId = 'tts_' + Date.now() + '_' + Math.random();
            broker.expose(fnId, fn);
            const registration = broker.invoke('core.addTTSProvider', [
                modelId,
                fnId,
                { name: opts.name }
            ]);
            registrations.push(registration);
            return async () => {
                try {
                    await broker.invoke('core.removeTTSProvider', [modelId, fnId]);
                } catch (e) {
                    // Ignore transport errors during unload
                } finally {
                    broker.unexpose(fnId);
                }
            };
        },
        addSTTProvider: (modelId, fn, opts = {}) => {
            const fnId = 'stt_' + Date.now() + '_' + Math.random();
            broker.expose(fnId, fn);
            const registration = broker.invoke('core.addSTTProvider', [
                modelId,
                fnId,
                { name: opts.name }
            ]);
            registrations.push(registration);
            return async () => {
                try {
                    await broker.invoke('core.removeSTTProvider', [modelId, fnId]);
                } catch (e) {
                    // Ignore transport errors during unload
                } finally {
                    broker.unexpose(fnId);
                }
            };
        },
        registerLLMType: (type, opts = {}) => {
            const p = broker.invoke('core.registerLLMType', [
                type,
                {
                    description: opts.description
                }
            ]);
            registrations.push(p);
            return async () => {
                try {
                    await broker.invoke('core.removeLLMType', [type]);
                } catch (e) {
                    // Ignore transport errors during unload
                }
            };
        },
        callLLM: (type, messages, signal) => {
            return broker.invoke('core.callLLM', [type, messages], signal);
        },
        streamLLM: (type, messages, signal) => {
            return broker.invokeStream('core.streamLLM', [type, messages], signal);
        },
        generateImage: (prompt, negativePrompt, referenceImages = [], styleImages = [], signal) => {
            return broker.invoke(
                'core.generateImage',
                [prompt, negativePrompt, referenceImages, styleImages],
                signal
            );
        },
        synthesizeSpeech: (text, signal) => {
            return broker.invoke('core.synthesizeSpeech', [text], signal);
        },
        transcribeSpeech: (audio, signal) => {
            return broker.invoke('core.transcribeSpeech', [audio], signal);
        },
        generateImageInlay: (
            chatId,
            prompt,
            negativePrompt,
            referenceImageInlayIds = [],
            styleImageInlayIds = [],
            signal
        ) => {
            return broker.invoke(
                'core.generateImageInlay',
                [
                    chatId,
                    prompt,
                    negativePrompt,
                    referenceImageInlayIds,
                    styleImageInlayIds
                ],
                signal
            );
        },
        synthesizeSpeechInlay: (chatId, text, signal) => {
            return broker.invoke('core.synthesizeSpeechInlay', [chatId, text], signal);
        },
        transcribeSpeechInlay: (chatId, audioInlayId, signal) => {
            return broker.invoke(
                'core.transcribeSpeechInlay',
                [chatId, audioInlayId],
                signal
            );
        }
    };
    
    window.__KeiPluginBootDone = async () => {
        try {
            await Promise.all(registrations);
            await broker.invoke('core.ready', [true]);
        } catch (error) {
            await broker.invoke('core.ready', [false, String(error)]);
        }
    };
    
    window.__KeiPluginBootFailed = async (error) => {
        const message = error instanceof Error ? error.message : String(error);
        await broker.invoke('core.ready', [false, message]);
    };
})();
`;
