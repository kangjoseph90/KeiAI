import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import {
	getOrCreateInstance,
	invokeHandler,
	destroyAllInstances,
	destroyInstancesByChatId
} from '$lib/charjs';
import { CharJSService, type CharJS } from '$lib/services/content/charjs';

const CHARJS_BASIC: CharJS = {
	id: 'script1',
	ownerId: 'owner1',
	name: '1',
	enabled: true,
	code: ''
};
const CHARJS_WITH_HANDLER: CharJS = {
	id: 'script2',
	ownerId: 'owner1',
	name: '2',
	enabled: true,
	code: `KeiAPI.addPipelineHandler('display', (data) => data + '_processed');`
};
const CHARJS_MULTI_HANDLER: CharJS = {
	id: 'script3',
	ownerId: 'owner1',
	name: '3',
	enabled: true,
	code: `
		KeiAPI.addPipelineHandler('display', (data) => data + '_a', { order: 1 });
		KeiAPI.addPipelineHandler('display', (data) => data + '_b', { order: 2 });
	`
};

// Map for spying
const DB = new Map<string, CharJS>([
	[CHARJS_BASIC.id, CHARJS_BASIC],
	[CHARJS_WITH_HANDLER.id, CHARJS_WITH_HANDLER],
	[CHARJS_MULTI_HANDLER.id, CHARJS_MULTI_HANDLER]
]);

describe('Engine Pool', () => {
	beforeEach(() => {
		vi.spyOn(CharJSService, 'get').mockImplementation(async (id) => {
			return DB.get(id) || null;
		});
	});

	afterEach(() => {
		destroyAllInstances();
		vi.restoreAllMocks();
	});

	describe('getOrCreateInstance', () => {
		it('returns null for empty code', async () => {
			const instance = await getOrCreateInstance('chat1', CHARJS_BASIC.id, false);
			expect(instance).toBeNull();
		});

		it('returns null for whitespace-only code', async () => {
			DB.set('empty_ws', {
				id: 'empty_ws',
				ownerId: 'o',
				name: '',
				enabled: true,
				code: '   \n\t  '
			});
			const instance = await getOrCreateInstance('chat1', 'empty_ws', false);
			expect(instance).toBeNull();
		});

		it('creates instance for valid code', async () => {
			const instance = await getOrCreateInstance('chat1', CHARJS_WITH_HANDLER.id, false);
			expect(instance).not.toBeNull();
			expect(instance!.chatId).toBe('chat1');
			expect(instance!.charjs.id).toBe(CHARJS_WITH_HANDLER.id);
		});

		it('returns cached instance on second call with same key', async () => {
			const a = await getOrCreateInstance('chat1', CHARJS_WITH_HANDLER.id, false);
			const b = await getOrCreateInstance('chat1', CHARJS_WITH_HANDLER.id, false);
			expect(a).toBe(b);
		});

		it('creates separate instances for different chatIds', async () => {
			const a = await getOrCreateInstance('chat1', CHARJS_WITH_HANDLER.id, false);
			const b = await getOrCreateInstance('chat2', CHARJS_WITH_HANDLER.id, false);
			expect(a).not.toBe(b);
		});

		it('rebuilds instance when allowLowLevel changes', async () => {
			const a = await getOrCreateInstance('chat1', CHARJS_WITH_HANDLER.id, false);
			const b = await getOrCreateInstance('chat1', CHARJS_WITH_HANDLER.id, true);
			expect(b).not.toBe(a);
		});

		it('registers pipeline handlers from script code', async () => {
			const instance = await getOrCreateInstance('chat1', CHARJS_MULTI_HANDLER.id, false);
			const handlers = instance!.pipelineHandlers.get('display');
			expect(handlers).toHaveLength(2);
			expect(handlers![0].order).toBe(1);
			expect(handlers![1].order).toBe(2);
		});
	});

	describe('invokeHandler', () => {
		it('processes data through a registered handler', async () => {
			const instance = await getOrCreateInstance('chat1', CHARJS_WITH_HANDLER.id, false);
			const handler = instance!.pipelineHandlers.get('display')![0];
			const result = await invokeHandler(instance!, handler.fnHandle, 'hello');
			expect(result).toBe('hello_processed');
		});

		it('chains multiple handlers in order', async () => {
			const instance = await getOrCreateInstance('chat1', CHARJS_MULTI_HANDLER.id, false);
			const handlers = instance!.pipelineHandlers.get('display')!;

			let data = 'start';
			for (const h of handlers) {
				const result = await invokeHandler(instance!, h.fnHandle, data);
				if (result !== undefined) data = result as string;
			}
			expect(data).toBe('start_a_b');
		});

		it('returns undefined on handler error', async () => {
			DB.set('error_script', {
				id: 'error_script',
				ownerId: 'o',
				name: '',
				enabled: true,
				code: `KeiAPI.addPipelineHandler('display', (data) => { throw new Error('boom'); });`
			});
			const instance = await getOrCreateInstance('chat1', 'error_script', false);
			const handler = instance!.pipelineHandlers.get('display')![0];
			const result = await invokeHandler(instance!, handler.fnHandle, 'test');
			expect(result).toBeUndefined();
		});

		it('serializes concurrent calls via mutex', async () => {
			DB.set('mutex_script', {
				id: 'mutex_script',
				ownerId: 'o',
				name: '',
				enabled: true,
				code: `KeiAPI.addPipelineHandler('display', (data) => data + '_done');`
			});
			const instance = await getOrCreateInstance('chat1', 'mutex_script', false);
			const handler = instance!.pipelineHandlers.get('display')![0];

			const results = await Promise.all(
				Array.from({ length: 10 }, (_, i) => invokeHandler(instance!, handler.fnHandle, `msg${i}`))
			);

			expect(results.every((r) => r !== undefined)).toBe(true);
			expect(results).toHaveLength(10);
		});
	});

	describe('destroyInstancesByChatId', () => {
		it('removes only instances for the given chatId', async () => {
			const a = await getOrCreateInstance('chat1', CHARJS_WITH_HANDLER.id, false);
			const b = await getOrCreateInstance('chat2', CHARJS_WITH_HANDLER.id, false);

			destroyInstancesByChatId('chat1');

			const a2 = await getOrCreateInstance('chat1', CHARJS_WITH_HANDLER.id, false);
			const b2 = await getOrCreateInstance('chat2', CHARJS_WITH_HANDLER.id, false);
			expect(a2).not.toBe(a);
			expect(b2).toBe(b);
		});
	});
});
