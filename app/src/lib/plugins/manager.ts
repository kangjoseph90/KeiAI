import { HostTransport } from './transport/host';
import { RPCBroker } from './rpc/broker';
import { guestSDK } from './sdk';
import type { Plugin } from '$lib/services/content/plugin';
import { getPlugin, updatePlugin } from '$lib/stores/content/plugin';
import { createLogger } from '$lib/adapters/logger';
import { emitEvent } from '$lib/events';
import type {
    LLMCapability,
    LLMTokenizer,
    LLMTypeDefinition,
    PluginLLMModel
} from '$lib/types/models/llm';
import type { PluginImageGenModel } from '$lib/types/models/imagegen';
import type { PluginTTSModel } from '$lib/types/models/tts';
import type { PluginSTTModel } from '$lib/types/models/stt';
import type { PluginEmbeddingModel } from '$lib/types/models/embedding';
import type { PluginRerankerModel } from '$lib/types/models/reranker';
import type { LLMMessage } from '$lib/llm/types';
import { callLLM, streamLLM } from '$lib/managers/llm';
import {
    rerank,
    searchChunks,
    searchDocuments,
    type RetrievalDocument
} from '$lib/managers/retrieval';
import {
    createInlay,
    generateImage,
    generateImageInlay,
    listInlays,
    readInlay,
    synthesizeSpeech,
    synthesizeSpeechInlay,
    transcribeSpeech,
    transcribeSpeechInlay,
    type MediaData
} from '$lib/managers/media';
import { getChat, getMessage, getRoom } from '$lib/stores';

const logger = createLogger('plugins:manager');
const PLUGIN_READY_TIMEOUT_MS = 5_000;
const PLUGIN_UNLOAD_TIMEOUT_MS = 1_000;
const DEFAULT_AUX_LLM_TYPE = 'aux';

export interface PluginInstance {
    pluginId: string;
    pluginName: string;
    iframe: HTMLIFrameElement;
    transport: HostTransport;
    broker: RPCBroker;
    pipelineHandlers: Map<string, Array<{ fnId: string; order: number }>>;
    eventListeners: Map<string, string[]>;
    macroHandlers: Map<string, { fnId: string; recursive?: boolean }>;
    llmProviders: Map<string, { fnId: string; model: PluginLLMModel }>;
    imageGenProviders: Map<string, { fnId: string; model: PluginImageGenModel }>;
    ttsProviders: Map<string, { fnId: string; model: PluginTTSModel }>;
    sttProviders: Map<string, { fnId: string; model: PluginSTTModel }>;
    embeddingProviders: Map<string, { fnId: string; model: PluginEmbeddingModel }>;
    rerankerProviders: Map<string, { fnId: string; model: PluginRerankerModel }>;
    llmTypes: Map<string, LLMTypeDefinition>;
    unloadHandlers: string[];
}

export class PluginManager {
    private instances = new Map<string, PluginInstance>();
    private pendingLoads = new Map<string, Promise<void>>();

    getInstances(): PluginInstance[] {
        return [...this.instances.values()];
    }

    /**
     * Loads a plugin by ID, waiting for its iframe to finish loading.
     * Safe to call concurrently for the same plugin ID.
     */
    async loadPlugin(pluginId: string): Promise<void> {
        if (this.instances.has(pluginId)) return;
        if (this.pendingLoads.has(pluginId)) {
            return this.pendingLoads.get(pluginId);
        }

        const loadPromise = (async () => {
            try {
                const plugin = await getPlugin(pluginId);
                if (!plugin) {
                    throw new Error(`Plugin not found: ${pluginId}`);
                }
                await this.doLoadPlugin(plugin);
            } finally {
                this.pendingLoads.delete(pluginId);
            }
        })();

        this.pendingLoads.set(pluginId, loadPromise);
        return loadPromise;
    }

    /**
     * Internal implementation of iframe creation and SDK injection.
     */
    private doLoadPlugin(plugin: Plugin): Promise<void> {
        return new Promise((resolve, reject) => {
            const iframe = document.createElement('iframe');
            iframe.style.position = 'absolute';
            iframe.style.width = '0';
            iframe.style.height = '0';
            iframe.style.border = '0';
            iframe.style.opacity = '0';
            iframe.style.pointerEvents = 'none';
            iframe.style.left = '-9999px';
            iframe.style.top = '0';
            iframe.sandbox.add('allow-scripts');

            const encodedPluginCode = JSON.stringify(plugin.code).replace(/</g, '\\u003C');

            // Embed plugin code safely as a JSON string to avoid </script> breakout issues
            const html = `
                <!DOCTYPE html>
                <html>
                <head>
                    <script>${guestSDK}</script>
                </head>
                <body>
                    <script>
                        (async function() {
                            try {
                                const code = ${encodedPluginCode};
                                new Function(code)();
                                await window.__KeiPluginBootDone();
                            } catch (error) {
                                await window.__KeiPluginBootFailed(error);
                            }
                        })();
                    </script>
                </body>
                </html>
            `;

            iframe.srcdoc = html;

            // Setup transport and bind APIs BEFORE appending iframe,
            // to catch any synchronous messages sent during script execution.
            const transport = new HostTransport(iframe);
            const broker = new RPCBroker(transport);

            const instance: PluginInstance = {
                pluginId: plugin.id,
                pluginName: plugin.name,
                iframe,
                transport,
                broker,
                pipelineHandlers: new Map(),
                eventListeners: new Map(),
                macroHandlers: new Map(),
                llmProviders: new Map(),
                imageGenProviders: new Map(),
                ttsProviders: new Map(),
                sttProviders: new Map(),
                embeddingProviders: new Map(),
                rerankerProviders: new Map(),
                llmTypes: new Map(),
                unloadHandlers: []
            };

            this.bindHostAPIs(instance);

            let completed = false;
            const cleanupAndReject = (error: Error): void => {
                if (completed) return;
                completed = true;
                transport.destroy();
                iframe.remove();
                reject(error);
            };

            const readyTimeout = setTimeout(() => {
                cleanupAndReject(new Error(`Plugin ready timeout: ${plugin.id}`));
            }, PLUGIN_READY_TIMEOUT_MS);

            broker.expose('core.ready', (ok: unknown, message: unknown) => {
                if (completed) return;
                completed = true;
                clearTimeout(readyTimeout);
                if (!ok) {
                    transport.destroy();
                    iframe.remove();
                    reject(new Error(`Plugin failed to load: ${plugin.id}: ${String(message)}`));
                    return;
                }
                this.instances.set(plugin.id, instance);
                logger.info(`Loaded plugin: ${plugin.name}`);
                resolve();
            });

            iframe.onerror = (err) => {
                logger.error(`Failed to load plugin ${plugin.id}`, err);
                clearTimeout(readyTimeout);
                cleanupAndReject(new Error(`Failed to load plugin iframe: ${plugin.id}`));
            };

            document.body.appendChild(iframe);
        });
    }

    /**
     * Binds core Host APIs that the guest can call.
     */
    private bindHostAPIs(instance: PluginInstance) {
        const {
            broker,
            pluginId,
            pluginName,
            pipelineHandlers,
            eventListeners,
            macroHandlers,
            unloadHandlers
        } = instance;

        broker.expose('core.log', (...args: unknown[]) => {
            const logArgs =
                args.at(-1) instanceof AbortSignal ? args.slice(0, args.length - 1) : args;
            createLogger(`plugin:${pluginName}`).info(...logArgs);
        });

        broker.expose('core.getArg', async (key: unknown) => {
            const plugin = await getPlugin(pluginId);
            return plugin?.args[String(key)];
        });

        broker.expose('core.setArg', async (key: unknown, val: unknown) => {
            const k = String(key);
            const plugin = await getPlugin(pluginId);
            if (!plugin) return;
            const args = { ...plugin.args, [k]: val };
            await updatePlugin(pluginId, { args } as Parameters<typeof updatePlugin>[1]).catch(
                console.error
            );
        });

        broker.expose('core.onPipeline', (phase: unknown, fnId: unknown, order: unknown) => {
            const phaseStr = String(phase);
            if (!pipelineHandlers.has(phaseStr)) pipelineHandlers.set(phaseStr, []);
            pipelineHandlers
                .get(phaseStr)!
                .push({ fnId: String(fnId), order: Number(order) || 100 });
        });

        broker.expose('core.onEvent', (event: unknown, fnId: unknown) => {
            const eventStr = String(event);
            if (!eventListeners.has(eventStr)) eventListeners.set(eventStr, []);
            eventListeners.get(eventStr)!.push(String(fnId));
        });

        broker.expose('core.offPipeline', (phase: unknown, fnId: unknown) => {
            const phaseStr = String(phase);
            const handlers = pipelineHandlers.get(phaseStr);
            if (handlers) {
                const idx = handlers.findIndex((h) => h.fnId === String(fnId));
                if (idx !== -1) handlers.splice(idx, 1);
            }
        });

        broker.expose('core.offEvent', (event: unknown, fnId: unknown) => {
            const eventStr = String(event);
            const listeners = eventListeners.get(eventStr);
            if (listeners) {
                const idx = listeners.indexOf(String(fnId));
                if (idx !== -1) listeners.splice(idx, 1);
            }
        });

        broker.expose('core.offMacro', (name: unknown, fnId: unknown) => {
            const current = macroHandlers.get(String(name));
            if (current && current.fnId === String(fnId)) {
                macroHandlers.delete(String(name));
            }
        });

        broker.expose('core.onUnload', (fnId: unknown) => {
            unloadHandlers.push(String(fnId));
        });

        broker.expose('core.registerMacro', (name: unknown, fnId: unknown, recursive: unknown) => {
            macroHandlers.set(String(name), { fnId: String(fnId), recursive: !!recursive });
        });

        broker.expose('core.emitEvent', (chatId: unknown, event: unknown, data: unknown) => {
            emitEvent(String(event), { chatId: String(chatId) }, data).catch((error: unknown) => {
                logger.error(`Plugin event emit failed:`, error);
            });
        });

        broker.expose('core.getRoom', (roomId: unknown) => getRoom(String(roomId)));
        broker.expose('core.getChat', (chatId: unknown) => getChat(String(chatId)));
        broker.expose('core.getMessage', (messageId: unknown) => getMessage(String(messageId)));
        broker.expose('core.listInlays', (chatId: unknown) => listInlays(String(chatId)));
        broker.expose('core.readInlay', (chatId: unknown, inlayId: unknown) =>
            readInlay(String(chatId), String(inlayId))
        );
        broker.expose('core.createInlay', (chatId: unknown, input: unknown) =>
            createInlay(String(chatId), readCreateInlayInput(input))
        );

        broker.expose('core.addLLMProvider', (modelId: unknown, fnId: unknown, opts: unknown) => {
            const mId = String(modelId);
            const fId = String(fnId);
            const options = (opts || {}) as {
                tokenizer?: LLMTokenizer;
                name?: string;
                unsupported?: unknown;
            };
            const unsupported = Array.isArray(options.unsupported)
                ? options.unsupported.filter(
                      (capability): capability is LLMCapability =>
                          capability === 'image_input' ||
                          capability === 'audio_input' ||
                          capability === 'video_input' ||
                          capability === 'streaming' ||
                          capability === 'tool_call'
                  )
                : undefined;

            const model: PluginLLMModel = {
                id: buildPluginModelId(pluginName, mId),
                name: options.name || mId,
                modelId: mId,
                provider: 'plugin',
                tokenizer: options.tokenizer || 'o200k_base',
                unsupported
            };

            instance.llmProviders.set(model.id, { fnId: fId, model });
        });

        broker.expose('core.removeLLMProvider', (modelId: unknown, fnId: unknown) => {
            const mId = String(modelId);
            const key = buildPluginModelId(pluginName, mId);
            const current = instance.llmProviders.get(key);
            if (current && current.fnId === String(fnId)) {
                instance.llmProviders.delete(key);
            }
        });

        broker.expose(
            'core.addImageGenProvider',
            (modelId: unknown, fnId: unknown, opts: unknown) => {
                const id = String(modelId);
                const options = (opts || {}) as { name?: string };
                const model: PluginImageGenModel = {
                    id: buildPluginModelId(pluginName, id),
                    modelId: id,
                    name: options.name || id,
                    provider: 'plugin'
                };
                instance.imageGenProviders.set(model.id, {
                    fnId: String(fnId),
                    model
                });
            }
        );

        broker.expose('core.removeImageGenProvider', (modelId: unknown, fnId: unknown) => {
            const id = String(modelId);
            const key = buildPluginModelId(pluginName, id);
            if (instance.imageGenProviders.get(key)?.fnId === String(fnId)) {
                instance.imageGenProviders.delete(key);
            }
        });

        broker.expose('core.addTTSProvider', (modelId: unknown, fnId: unknown, opts: unknown) => {
            const id = String(modelId);
            const options = (opts || {}) as { name?: string };
            const model: PluginTTSModel = {
                id: buildPluginModelId(pluginName, id),
                modelId: id,
                name: options.name || id,
                provider: 'plugin'
            };
            instance.ttsProviders.set(model.id, {
                fnId: String(fnId),
                model
            });
        });

        broker.expose('core.removeTTSProvider', (modelId: unknown, fnId: unknown) => {
            const id = String(modelId);
            const key = buildPluginModelId(pluginName, id);
            if (instance.ttsProviders.get(key)?.fnId === String(fnId)) {
                instance.ttsProviders.delete(key);
            }
        });

        broker.expose('core.addSTTProvider', (modelId: unknown, fnId: unknown, opts: unknown) => {
            const id = String(modelId);
            const options = (opts || {}) as { name?: string };
            const model: PluginSTTModel = {
                id: buildPluginModelId(pluginName, id),
                modelId: id,
                name: options.name || id,
                provider: 'plugin'
            };
            instance.sttProviders.set(model.id, {
                fnId: String(fnId),
                model
            });
        });

        broker.expose('core.removeSTTProvider', (modelId: unknown, fnId: unknown) => {
            const id = String(modelId);
            const key = buildPluginModelId(pluginName, id);
            if (instance.sttProviders.get(key)?.fnId === String(fnId)) {
                instance.sttProviders.delete(key);
            }
        });

        broker.expose(
            'core.addEmbeddingProvider',
            (modelId: unknown, fnId: unknown, opts: unknown) => {
                const id = String(modelId);
                const options = (opts || {}) as { name?: string };
                const model: PluginEmbeddingModel = {
                    id: buildPluginModelId(pluginName, id),
                    modelId: id,
                    name: options.name || id,
                    provider: 'plugin'
                };
                instance.embeddingProviders.set(model.id, {
                    fnId: String(fnId),
                    model
                });
            }
        );

        broker.expose('core.removeEmbeddingProvider', (modelId: unknown, fnId: unknown) => {
            const id = String(modelId);
            const key = buildPluginModelId(pluginName, id);
            if (instance.embeddingProviders.get(key)?.fnId === String(fnId)) {
                instance.embeddingProviders.delete(key);
            }
        });

        broker.expose(
            'core.addRerankerProvider',
            (modelId: unknown, fnId: unknown, opts: unknown) => {
                const id = String(modelId);
                const options = (opts || {}) as { name?: string };
                const model: PluginRerankerModel = {
                    id: buildPluginModelId(pluginName, id),
                    modelId: id,
                    name: options.name || id,
                    provider: 'plugin'
                };
                instance.rerankerProviders.set(model.id, {
                    fnId: String(fnId),
                    model
                });
            }
        );

        broker.expose('core.removeRerankerProvider', (modelId: unknown, fnId: unknown) => {
            const id = String(modelId);
            const key = buildPluginModelId(pluginName, id);
            if (instance.rerankerProviders.get(key)?.fnId === String(fnId)) {
                instance.rerankerProviders.delete(key);
            }
        });

        broker.expose('core.registerLLMType', (type: unknown, opts: unknown) => {
            const llmType = String(type);
            const options = (opts || {}) as { description?: string };

            instance.llmTypes.set(llmType, {
                type: llmType,
                description: options.description
            });

            return llmType;
        });

        broker.expose('core.removeLLMType', (type: unknown) => {
            instance.llmTypes.delete(String(type));
        });

        broker.expose(
            'core.streamLLM',
            (type: unknown, messages: unknown, signal: unknown, options: unknown) => {
                const callOptions = readLLMCallOptions(options);
                return streamLLM(
                    callOptions.type ?? String(type || DEFAULT_AUX_LLM_TYPE),
                    messages as LLMMessage[],
                    readAbortSignal(signal),
                    {
                        maxResponse: callOptions.maxResponse
                    }
                );
            }
        );

        broker.expose(
            'core.callLLM',
            (type: unknown, messages: unknown, signal: unknown, options: unknown) => {
                const callOptions = readLLMCallOptions(options);
                const llmType = callOptions.type ?? String(type || DEFAULT_AUX_LLM_TYPE);
                return callLLM(llmType, messages as LLMMessage[], readAbortSignal(signal), {
                    maxResponse: callOptions.maxResponse
                });
            }
        );

        broker.expose(
            'core.generateImage',
            (
                prompt: unknown,
                negativePrompt: unknown,
                referenceImages: unknown,
                styleImages: unknown,
                signal: unknown
            ) =>
                generateImage(
                    {
                        prompt: String(prompt),
                        ...readOptionalPrompt(negativePrompt),
                        referenceImages: readMediaArray(referenceImages, 'referenceImages'),
                        styleImages: readMediaArray(styleImages, 'styleImages')
                    },
                    readAbortSignal(signal)
                )
        );

        broker.expose('core.synthesizeSpeech', (text: unknown, signal: unknown) =>
            synthesizeSpeech(String(text), readAbortSignal(signal))
        );

        broker.expose(
            'core.transcribeSpeech',
            async (audio: unknown, signal: unknown) =>
                (await transcribeSpeech(readMediaData(audio, 'audio'), readAbortSignal(signal)))
                    .text
        );

        broker.expose(
            'core.searchChunks',
            (query: unknown, chunks: unknown, topKOrSignal: unknown, signal: unknown) => {
                const options = readSearchOptions(topKOrSignal, signal);
                return searchChunks(
                    String(query),
                    readStringArray(chunks, 'chunks'),
                    options.signal,
                    options.topK
                );
            }
        );

        broker.expose(
            'core.searchDocuments',
            (query: unknown, documents: unknown, topKOrSignal: unknown, signal: unknown) => {
                const options = readSearchOptions(topKOrSignal, signal);
                return searchDocuments(
                    String(query),
                    readRetrievalDocuments(documents),
                    options.signal,
                    options.topK
                );
            }
        );

        broker.expose('core.rerank', (query: unknown, documents: unknown, signal: unknown) =>
            rerank(String(query), readStringArray(documents, 'documents'), readAbortSignal(signal))
        );

        broker.expose(
            'core.generateImageInlay',
            (
                chatId: unknown,
                prompt: unknown,
                negativePrompt: unknown,
                referenceImageInlayIds: unknown,
                styleImageInlayIds: unknown,
                signal: unknown
            ) =>
                generateImageInlay(
                    String(chatId),
                    {
                        prompt: String(prompt),
                        ...readOptionalPrompt(negativePrompt),
                        referenceImageInlayIds: readStringArray(
                            referenceImageInlayIds,
                            'referenceImageInlayIds'
                        ),
                        styleImageInlayIds: readStringArray(
                            styleImageInlayIds,
                            'styleImageInlayIds'
                        )
                    },
                    readAbortSignal(signal)
                )
        );

        broker.expose(
            'core.synthesizeSpeechInlay',
            (chatId: unknown, text: unknown, signal: unknown) =>
                synthesizeSpeechInlay(String(chatId), String(text), readAbortSignal(signal))
        );

        broker.expose(
            'core.transcribeSpeechInlay',
            (chatId: unknown, audioInlayId: unknown, signal: unknown) =>
                transcribeSpeechInlay(String(chatId), String(audioInlayId), readAbortSignal(signal))
        );
    }

    /**
     * Destroys a specific running plugin and removes its iframe.
     */
    async unloadPlugin(pluginId: string): Promise<void> {
        const pendingLoad = this.pendingLoads.get(pluginId);
        if (pendingLoad) {
            await pendingLoad.catch((error: unknown) => {
                logger.warn(`Plugin load failed before unload ${pluginId}:`, error);
            });
        }

        const instance = this.instances.get(pluginId);
        if (instance) {
            await this.invokeUnloadHandlers(instance);
            instance.transport.destroy();
            instance.iframe.remove();
            this.instances.delete(pluginId);
            logger.info(`Unloaded plugin: ${pluginId}`);
        }
    }

    async reloadPlugin(pluginId: string): Promise<void> {
        await this.unloadPlugin(pluginId);
        await this.loadPlugin(pluginId);
    }

    /**
     * Destroys all running plugins and removes their iframes.
     */
    async destroyAll(): Promise<void> {
        for (const id of this.instances.keys()) {
            await this.unloadPlugin(id);
        }
    }

    private async invokeUnloadHandlers(instance: PluginInstance): Promise<void> {
        if (instance.unloadHandlers.length === 0) return;

        const unload = Promise.allSettled(
            instance.unloadHandlers.map((fnId) => instance.broker.invoke(fnId, []))
        );
        const timeout = new Promise<void>((resolve) => {
            setTimeout(resolve, PLUGIN_UNLOAD_TIMEOUT_MS);
        });

        await Promise.race([unload, timeout]);
    }
}

export const pluginManager = new PluginManager();

function buildPluginModelId(pluginName: string, modelId: string): string {
    return `plugin::${pluginName}::${modelId}`;
}

function readAbortSignal(value: unknown): AbortSignal {
    return value instanceof AbortSignal ? value : new AbortController().signal;
}

function readSearchOptions(
    topKOrSignal: unknown,
    signal: unknown
): { topK: number | undefined; signal: AbortSignal } {
    return {
        topK:
            topKOrSignal === undefined || topKOrSignal instanceof AbortSignal
                ? undefined
                : typeof topKOrSignal === 'number'
                  ? topKOrSignal
                  : NaN,
        signal: readAbortSignal(topKOrSignal instanceof AbortSignal ? topKOrSignal : signal)
    };
}

function readOptionalPrompt(value: unknown): { negativePrompt?: string } {
    return typeof value === 'string' && value.trim() ? { negativePrompt: value } : {};
}

function readMediaArray(value: unknown, name: string): MediaData[] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
        throw new Error(`${name} must be an array`);
    }
    return value.map((item, index) => readMediaData(item, `${name}[${index}]`));
}

function readMediaData(value: unknown, name: string): MediaData {
    if (typeof value !== 'object' || value === null) {
        throw new Error(`${name} must be media data`);
    }
    const record = value as Record<string, unknown>;
    if (!(record.data instanceof Uint8Array) || typeof record.mimeType !== 'string') {
        throw new Error(`${name} must contain Uint8Array data and a mimeType`);
    }
    return {
        data: new Uint8Array(record.data),
        mimeType: record.mimeType
    };
}

function readCreateInlayInput(value: unknown): {
    name: string;
    mimeType: string;
    data: Uint8Array<ArrayBuffer>;
} {
    if (!value || typeof value !== 'object') {
        throw new Error('inlay must contain a name, mimeType, and Uint8Array data');
    }
    const record = value as Record<string, unknown>;
    if (
        typeof record.name !== 'string' ||
        typeof record.mimeType !== 'string' ||
        !(record.data instanceof Uint8Array)
    ) {
        throw new Error('inlay must contain a name, mimeType, and Uint8Array data');
    }
    return {
        name: record.name,
        mimeType: record.mimeType,
        data: new Uint8Array(record.data)
    };
}

function readStringArray(value: unknown, name: string): string[] {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
        throw new Error(`${name} must be an array of strings`);
    }
    return value;
}

function readRetrievalDocuments(value: unknown): RetrievalDocument[] {
    if (!Array.isArray(value)) {
        throw new Error('documents must be an array of objects with a chunks array');
    }
    return value.map((document) => {
        if (!document || typeof document !== 'object' || !('chunks' in document)) {
            throw new Error('documents must be an array of objects with a chunks array');
        }
        const chunks = readStringArray(document.chunks, 'document.chunks');
        if (chunks.length === 0) throw new Error('document.chunks cannot be empty');
        return { chunks };
    });
}

function readLLMCallOptions(value: unknown): { type?: string; maxResponse?: number } {
    if (!value || typeof value !== 'object') return {};
    const record = value as Record<string, unknown>;
    return {
        type: typeof record.type === 'string' && record.type.trim() ? record.type : undefined,
        maxResponse:
            typeof record.maxResponse === 'number' && Number.isFinite(record.maxResponse)
                ? record.maxResponse
                : undefined
    };
}
