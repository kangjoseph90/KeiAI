import type { QuickJSAsyncContext, QuickJSHandle } from 'quickjs-emscripten';
import type { Mutex } from '$lib/utils/mutex';

/** Stored in Character/Module encrypted data */
export interface CharJS {
	code: string;
	allowLowLevel: boolean;
}

/** Runtime instance managed by the engine pool */
export interface CharJSInstance {
	ownerId: string;
	chatId: string;
	code: string;
	allowLowLevel: boolean;
	ctx: QuickJSAsyncContext;
	pipelineHandlers: Map<string, Array<{ order: number; fnHandle: QuickJSHandle }>>;
	eventListeners: Map<string, QuickJSHandle[]>;
	lastAccessed: number;
	mutex: Mutex;
}
