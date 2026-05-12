/**
 * Event System
 * Central dispatcher for all app events.
 * Consumers: CharJS sandbox, plugins (future).
 *
 * Built-in events:
 *  message:sent      { content: string }
 *  message:received  { content: string }
 *  chat:started      {}
 *  chat:switched     {}
 *  chat:deleted      {}
 *
 * fire-and-forget - do not wait for finish
 *
 * Type-safe overloads mirror the pipeline system:
 *  emitEvent(chatId, built-in, typed-data)  — compile-time checked
 *  emitEvent(chatId, custom, unknown)        — open for extension
 */

import { collectCharJSInstances, invokeHandler } from '$lib/charjs';
import { pluginManager } from '$lib/plugins';
import type { EventType, EventName } from './types';
import { isSafeMode } from '$lib/config';

// ── Built-in events (fully typed) ──────────────────────────────────

export async function emitEvent<K extends keyof EventType>(
    chatId: string,
    event: K,
    data: EventType[K]
): Promise<void>;

// ── Custom events (open extension) ──────────────────────────────────

export async function emitEvent<E extends string>(
    chatId: string,
    event: EventName<E>,
    data?: unknown
): Promise<void>;

// ── Implementation ───────────────────────────────────────────────────

// TODO: get character id here
export async function emitEvent(chatId: string, event: string, data?: unknown): Promise<void> {
    if (isSafeMode()) return;

    try {
        await emitPluginEvent(event, data);
        await emitCharJSEvents(chatId, event, data);
    } catch (error) {
        console.error(`Error emitting event '${event}' for chat ${chatId}:`, error);
    }
}

async function emitCharJSEvents(chatId: string, event: string, data?: unknown): Promise<void> {
    const instances = await collectCharJSInstances(chatId, 'event', event);

    for (const instance of instances) {
        const listeners = instance.eventListeners.get(event) ?? [];
        for (const listener of listeners) {
            // Fire and forget to prevent deadlock, and use setTimeout (macro-task) to prevent UI freezing
            setTimeout(() => {
                invokeHandler(instance, listener.fnHandle, data ?? null).catch((err) => {
                    console.error(
                        `Event '${event}' handler error for script ${instance.charjs.name}:`,
                        err
                    );
                });
            }, 0);
        }
    }
}

async function emitPluginEvent(event: string, data?: unknown): Promise<void> {
    for (const instance of pluginManager.getInstances()) {
        const listeners = instance.eventListeners.get(event) ?? [];
        for (const fnId of listeners) {
            instance.broker.fireEvent(fnId, [data ?? null]);
        }
    }
}
