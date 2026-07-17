/**
 * Event System
 * Central dispatcher for all app events.
 * Consumers: CharJS sandbox, plugins (future).
 *
 * fire-and-forget - do not wait for finish
 *
 * Type-safe overloads mirror the pipeline system:
 *  emitEvent(built-in, ctx, typed-data)  — compile-time checked
 *  emitEvent(custom, ctx, unknown)       — open for extension
 */

import { collectCharJSInstances, invokeHandler } from '$lib/charjs';
import { pluginManager } from '$lib/plugins';
import type { EventType, EventName } from './types';
import { isSafeMode } from '$lib/config';
import { createLogger } from '$lib/adapters/logger';
import type { RuntimeContext } from '$lib/types/context';

const logger = createLogger('event');

// ── Built-in events (fully typed) ──────────────────────────────────

export async function emitEvent<K extends keyof EventType>(
    event: K,
    ctx: RuntimeContext,
    data: EventType[K]
): Promise<void>;

// ── Custom events (open extension) ──────────────────────────────────

export async function emitEvent<E extends string>(
    event: EventName<E>,
    ctx: RuntimeContext,
    data?: unknown
): Promise<void>;

// ── Implementation ───────────────────────────────────────────────────

export async function emitEvent(event: string, ctx: RuntimeContext, data?: unknown): Promise<void> {
    if (isSafeMode()) return;

    try {
        await emitPluginEvent(event, data);
        if (ctx.chatId) await emitCharJSEvents({ ...ctx, chatId: ctx.chatId }, event, data);
    } catch (error) {
        logger.error(`Failed to emit ${event}`, error);
    }
}

async function emitCharJSEvents(
    ctx: RuntimeContext & { chatId: string },
    event: string,
    data?: unknown
): Promise<void> {
    const instances = await collectCharJSInstances(ctx.chatId, 'event', event, ctx.characterId);

    for (const instance of instances) {
        const listeners = instance.eventListeners.get(event) ?? [];
        for (const listener of listeners) {
            // Fire and forget to prevent deadlock, and use setTimeout (macro-task) to prevent UI freezing
            setTimeout(() => {
                invokeHandler(instance, listener.fnHandle, data ?? null).catch((err) => {
                    logger.error(`Handler failed for ${event} in ${instance.charjs.name}`, err);
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
