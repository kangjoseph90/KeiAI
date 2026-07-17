/** Built-in event types and their data shapes */
export interface EventType {
    'message:sent': { content: string };
    'message:received': { content: string };
}

/**
 * Branded type for custom (non-built-in) event names.
 * Prevents accidentally passing a built-in event name where a custom one is expected.
 */
export type EventName<E> = E extends keyof EventType ? never : E;
