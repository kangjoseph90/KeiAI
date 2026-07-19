import type { QuickJSAsyncContext, QuickJSAsyncRuntime, QuickJSHandle } from 'quickjs-emscripten';
import type { Mutex } from '$lib/utils/mutex';

import type { CharJS } from '$lib/services';

export type ModeKind = 'pipe' | 'event' | 'template';

/** Runtime instance managed by the engine pool */
export interface CharJSInstance {
    charjs: CharJS;
    chatId: string;
    mode: string;
    allowLowLevel: boolean;
    runtime: QuickJSAsyncRuntime;
    ctx: QuickJSAsyncContext;
    pipelineHandlers: Map<string, Array<{ id: string; order: number; fnHandle: QuickJSHandle }>>;
    eventListeners: Map<string, Array<{ id: string; fnHandle: QuickJSHandle }>>;
    macroHandlers: Map<string, { id: string; fnHandle: QuickJSHandle; recursive?: boolean }>;
    lastAccessed: number;
    mutex: Mutex;
}
