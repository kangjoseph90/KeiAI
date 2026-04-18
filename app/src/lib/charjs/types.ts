import type { QuickJSAsyncContext, QuickJSAsyncRuntime, QuickJSHandle } from 'quickjs-emscripten';
import type { Mutex } from '$lib/utils/mutex';

import type { CharJS } from '$lib/services/content/charjs';

/** Runtime instance managed by the engine pool */
export interface CharJSInstance {
	charjs: CharJS;
	chatId: string;
	allowLowLevel: boolean;
	runtime: QuickJSAsyncRuntime;
	ctx: QuickJSAsyncContext;
	pipelineHandlers: Map<string, Array<{ order: number; fnHandle: QuickJSHandle }>>;
	eventListeners: Map<string, QuickJSHandle[]>;
	lastAccessed: number;
	mutex: Mutex;
}
