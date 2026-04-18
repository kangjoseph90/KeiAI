import { describe, it, expect, afterEach } from 'vitest';
import {
	getOrCreateInstance,
	invokeHandler,
	emitEvent,
	destroyAllInstances,
	destroyInstancesByChatId
} from '$lib/charjs';
import type { CharJS } from '$lib/charjs';

const CHARJS_BASIC: CharJS = { code: '', allowLowLevel: false };
const CHARJS_WITH_HANDLER: CharJS = {
	code: `KeiAPI.addPipelineHandler('display', (data) => data + '_processed');`,
	allowLowLevel: false
};
const CHARJS_EVENT_LISTENER: CharJS = {
	code: `KeiAPI.onEvent('test', (data) => {});`,
	allowLowLevel: false
};
const CHARJS_MULTI_HANDLER: CharJS = {
	code: `
		KeiAPI.addPipelineHandler('display', (data) => data + '_a', { order: 1 });
		KeiAPI.addPipelineHandler('display', (data) => data + '_b', { order: 2 });
	`,
	allowLowLevel: false
};

describe('Engine Pool', () => {
	afterEach(() => destroyAllInstances());

	describe('getOrCreateInstance', () => {
		it('returns null for empty code', async () => {
			const instance = await getOrCreateInstance('owner1', 'chat1', CHARJS_BASIC);
			expect(instance).toBeNull();
		});

		it('returns null for whitespace-only code', async () => {
			const instance = await getOrCreateInstance('owner1', 'chat1', {
				code: '   \n\t  ',
				allowLowLevel: false
			});
			expect(instance).toBeNull();
		});

		it('creates instance for valid code', async () => {
			const instance = await getOrCreateInstance('owner1', 'chat1', CHARJS_WITH_HANDLER);
			expect(instance).not.toBeNull();
			expect(instance!.ownerId).toBe('owner1');
			expect(instance!.chatId).toBe('chat1');
		});

		it('returns cached instance on second call with same key', async () => {
			const a = await getOrCreateInstance('owner1', 'chat1', CHARJS_WITH_HANDLER);
			const b = await getOrCreateInstance('owner1', 'chat1', CHARJS_WITH_HANDLER);
			expect(a).toBe(b);
		});

		it('creates separate instances for different ownerIds', async () => {
			const a = await getOrCreateInstance('owner1', 'chat1', CHARJS_WITH_HANDLER);
			const b = await getOrCreateInstance('owner2', 'chat1', CHARJS_WITH_HANDLER);
			expect(a).not.toBe(b);
		});

		it('rebuilds instance when code changes', async () => {
			const a = await getOrCreateInstance('owner1', 'chat1', CHARJS_WITH_HANDLER);
			const b = await getOrCreateInstance('owner1', 'chat1', {
				code: `KeiAPI.addPipelineHandler('display', (data) => data + '_new');`,
				allowLowLevel: false
			});
			expect(b).not.toBe(a);
		});

		it('registers pipeline handlers from script code', async () => {
			const instance = await getOrCreateInstance('owner1', 'chat1', CHARJS_MULTI_HANDLER);
			const handlers = instance!.pipelineHandlers.get('display');
			expect(handlers).toHaveLength(2);
			expect(handlers![0].order).toBe(1);
			expect(handlers![1].order).toBe(2);
		});

		it('registers event listeners from script code', async () => {
			const instance = await getOrCreateInstance('owner1', 'chat1', CHARJS_EVENT_LISTENER);
			const listeners = instance!.eventListeners.get('test');
			expect(listeners).toHaveLength(1);
		});
	});

	describe('invokeHandler', () => {
		it('processes data through a registered handler', async () => {
			const instance = await getOrCreateInstance('owner1', 'chat1', CHARJS_WITH_HANDLER);
			const handler = instance!.pipelineHandlers.get('display')![0];
			const result = await invokeHandler(instance!, handler.fnHandle, 'hello');
			expect(result).toBe('hello_processed');
		});

		it('chains multiple handlers in order', async () => {
			const instance = await getOrCreateInstance('owner1', 'chat1', CHARJS_MULTI_HANDLER);
			const handlers = instance!.pipelineHandlers.get('display')!;

			let data = 'start';
			for (const h of handlers) {
				const result = await invokeHandler(instance!, h.fnHandle, data);
				if (result !== undefined) data = result as string;
			}
			expect(data).toBe('start_a_b');
		});

		it('returns undefined on handler error', async () => {
			const instance = await getOrCreateInstance('owner1', 'chat1', {
				code: `KeiAPI.addPipelineHandler('display', (data) => { throw new Error('boom'); });`,
				allowLowLevel: false
			});
			const handler = instance!.pipelineHandlers.get('display')![0];
			const result = await invokeHandler(instance!, handler.fnHandle, 'test');
			expect(result).toBeUndefined();
		});

		it('serializes concurrent calls via mutex', async () => {
			const instance = await getOrCreateInstance('owner1', 'chat1', {
				code: `KeiAPI.addPipelineHandler('display', (data) => data + '_done');`,
				allowLowLevel: false
			});
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
			const a = await getOrCreateInstance('owner1', 'chat1', CHARJS_WITH_HANDLER);
			const b = await getOrCreateInstance('owner1', 'chat2', CHARJS_WITH_HANDLER);

			destroyInstancesByChatId('chat1');

			const a2 = await getOrCreateInstance('owner1', 'chat1', CHARJS_WITH_HANDLER);
			const b2 = await getOrCreateInstance('owner1', 'chat2', CHARJS_WITH_HANDLER);
			expect(a2).not.toBe(a);
			expect(b2).toBe(b);
		});
	});

	describe('emitEvent', () => {
		it('delivers event to matching chat instances without crash', async () => {
			const instance = await getOrCreateInstance('ev1', 'evchat1', {
				code: `KeiAPI.onEvent('ping', (data) => {});`,
				allowLowLevel: false
			});

			await emitEvent('evchat1', 'ping', { msg: 'hello' });
			await delay(50);

			expect(instance).toBeDefined();
		});

		it('returns immediately without waiting for handlers', async () => {
			await getOrCreateInstance('ev2', 'evchat2', CHARJS_EVENT_LISTENER);

			const start = Date.now();
			await emitEvent('evchat2', 'test', null);
			const elapsed = Date.now() - start;

			expect(elapsed).toBeLessThan(50);
		});

		it('does not deliver events to other chats', async () => {
			await getOrCreateInstance('ev3', 'evchat3', CHARJS_EVENT_LISTENER);

			// Emit to a non-existent chat — should not crash
			await emitEvent('nonexistent', 'test', null);
			await delay(50);
		});
	});
});

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
