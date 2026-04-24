import { HostTransport } from './transport/host';
import { RPCBroker } from './rpc/broker';
import { guestSDK } from './sdk';
import type { Plugin } from '$lib/services/content/plugin';
import { getPlugin, updatePlugin } from '$lib/stores/content/plugin';
import { getAppSettings } from '$lib/stores/content/settings';
import { createLogger } from '$lib/adapters/logger';

const logger = createLogger('plugins:manager');
const PLUGIN_READY_TIMEOUT_MS = 5_000;

export interface PluginInstance {
    pluginId: string;
    iframe: HTMLIFrameElement;
    transport: HostTransport;
    broker: RPCBroker;
    pipelineHandlers: Map<string, Array<{ fnId: string; order: number }>>;
    eventListeners: Map<string, string[]>;
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
            iframe.style.display = 'none';
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
                eventListeners: new Map()
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
        const { broker, pluginId, pipelineHandlers, eventListeners } = instance;

        broker.expose('core.log', (...args: unknown[]) => {
            createLogger(`plugin:${pluginId}`).info(...args);
        });

        broker.expose('core.getArg', async (key: unknown) => {
            const plugin = await getPlugin(pluginId);
            return plugin.args[String(key)];
        });

        broker.expose('core.setArg', async (key: unknown, val: unknown) => {
            const k = String(key);
            const plugin = await getPlugin(pluginId);
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

        broker.expose('core.emitEvent', (event: unknown, data: unknown) => {
            import('$lib/events')
                .then(({ emitEvent }) => emitEvent('system', String(event), data))
                .catch((error: unknown) => {
                    logger.error(`Plugin event emit failed:`, error);
                });
        });
    }

    /**
     * Destroys a specific running plugin and removes its iframe.
     */
    unloadPlugin(pluginId: string): void {
        const instance = this.instances.get(pluginId);
        if (instance) {
            instance.transport.destroy();
            instance.iframe.remove();
            this.instances.delete(pluginId);
            logger.info(`Unloaded plugin: ${pluginId}`);
        }
    }

    /**
     * Destroys all running plugins and removes their iframes.
     */
    destroyAll(): void {
        for (const id of this.instances.keys()) {
            this.unloadPlugin(id);
        }
    }

    async syncActivePlugins(): Promise<void> {
        if (typeof document === 'undefined') return;

        const settings = await getAppSettings();
        const activePluginIds = new Set(
            (settings.pluginRefs ?? []).filter((ref) => ref.enabled).map((ref) => ref.id)
        );

        for (const pluginId of activePluginIds) {
            try {
                await this.loadPlugin(pluginId);
            } catch (error) {
                logger.error(`Failed to load plugin ${pluginId}:`, error);
            }
        }

        for (const pluginId of this.instances.keys()) {
            if (!activePluginIds.has(pluginId)) {
                this.unloadPlugin(pluginId);
            }
        }
    }
}

export const pluginManager = new PluginManager();
