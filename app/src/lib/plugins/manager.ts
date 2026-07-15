import { HostTransport } from './transport/host';
import { RPCBroker } from './rpc/broker';
import { guestSDK } from './sdk';
import type { Plugin } from '$lib/services/content/plugin';
import { getPlugin, updatePlugin } from '$lib/stores/content/plugin';
import { getAppSettings } from '$lib/stores/content/settings';
import { createLogger } from '$lib/adapters/logger';
import { emitEvent } from '$lib/events';
import type { LLMTokenizer, LLMTypeDefinition, PluginLLMModel } from '$lib/types/models/llm';
import type { LLMMessage, LLMStreamContent } from '$lib/llm/types';
import { resolveLLMModelConfig, resolveLLMParameters, selectLLMHandler } from '$lib/llm/handler';

const logger = createLogger('plugins:manager');
const PLUGIN_READY_TIMEOUT_MS = 5_000;
const PLUGIN_UNLOAD_TIMEOUT_MS = 1_000;
const DEFAULT_AUX_LLM_TYPE = 'aux';
const DEFAULT_AUX_MAX_RESPONSE = 4096;

export interface PluginInstance {
    pluginId: string;
    iframe: HTMLIFrameElement;
    transport: HostTransport;
    broker: RPCBroker;
    pipelineHandlers: Map<string, Array<{ fnId: string; order: number }>>;
    eventListeners: Map<string, string[]>;
    macroHandlers: Map<string, { fnId: string; recursive?: boolean }>;
    llmProviders: Map<string, { fnId: string; model: PluginLLMModel }>;
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
            // to catch any synchronous messages sent during inline script execution.
            const transport = new HostTransport(iframe);
            const broker = new RPCBroker(transport);

            const instance: PluginInstance = {
                pluginId: plugin.id,
                iframe,
                transport,
                broker,
                pipelineHandlers: new Map(),
                eventListeners: new Map(),
                macroHandlers: new Map(),
                llmProviders: new Map(),
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
            pipelineHandlers,
            eventListeners,
            macroHandlers,
            unloadHandlers
        } = instance;

        broker.expose('core.log', (...args: unknown[]) => {
            const logArgs =
                args.at(-1) instanceof AbortSignal ? args.slice(0, args.length - 1) : args;
            createLogger(`plugin:${pluginId}`).info(...logArgs);
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
            emitEvent(String(chatId), String(event), data).catch((error: unknown) => {
                logger.error(`Plugin event emit failed:`, error);
            });
        });

        broker.expose('core.addLLMProvider', (modelId: unknown, fnId: unknown, opts: unknown) => {
            const mId = String(modelId);
            const fId = String(fnId);
            const options = (opts || {}) as { tokenizer?: LLMTokenizer; name?: string };

            const model: PluginLLMModel = {
                id: `plugin::${mId}`,
                name: options.name || mId,
                modelId: mId,
                provider: 'plugin',
                tokenizer: options.tokenizer || 'o200k_base'
            };

            instance.llmProviders.set(mId, { fnId: fId, model });
        });

        broker.expose('core.removeLLMProvider', (modelId: unknown, fnId: unknown) => {
            const mId = String(modelId);
            const current = instance.llmProviders.get(mId);
            if (current && current.fnId === String(fnId)) {
                instance.llmProviders.delete(mId);
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

        async function* streamLLM(
            type: unknown,
            messages: unknown,
            signal: unknown,
            options: unknown
        ): AsyncIterable<LLMStreamContent> {
            const abortSignal = signal instanceof AbortSignal ? signal : undefined;
            const callOptions = readLLMCallOptions(options);
            const llmType = callOptions.type ?? String(type || DEFAULT_AUX_LLM_TYPE);
            const settings = await getAppSettings();
            if (!settings.presetId) {
                throw new Error('No active preset selected');
            }

            const modelConfig = await resolveLLMModelConfig(llmType, settings.presetId);
            if (!modelConfig) {
                throw new Error(`No model configured for LLM type: ${llmType}`);
            }

            const handler = selectLLMHandler(modelConfig, settings);
            if (!handler) {
                throw new Error('Failed to create LLM handler');
            }

            const parameters = (await resolveLLMParameters(llmType, settings.presetId)) ?? {};
            yield* handler.stream(
                messages as LLMMessage[],
                abortSignal ?? new AbortController().signal,
                {
                    parameters,
                    maxResponse: callOptions.maxResponse ?? DEFAULT_AUX_MAX_RESPONSE
                }
            );
        }

        broker.expose('core.streamLLM', streamLLM);

        broker.expose(
            'core.callLLM',
            async (type: unknown, messages: unknown, signal: unknown, options: unknown) => {
                let content = '';
                for await (const chunk of streamLLM(type, messages, signal, options)) {
                    content = chunk.content;
                }
                return content;
            }
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
