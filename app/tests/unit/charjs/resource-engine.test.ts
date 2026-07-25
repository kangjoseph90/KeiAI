import { get } from 'svelte/store';
import { afterEach, describe, expect, it } from 'vitest';
import { destroyAllInstances, getOrCreateInstance, invokeHandler } from '$lib/charjs';
import type { CharJS } from '$lib/services';
import { toastItems } from '$lib/ui/state';

const script: CharJS = {
    id: 'parent-script',
    sortOrder: 'a',
    name: 'Parent Script',
    enabled: true,
    code: `KeiAPI.onPipeline('display', (data) => data + '_parent');`
};

describe('parent-owned CharJS engine', () => {
    afterEach(() => {
        destroyAllInstances();
        toastItems.set([]);
    });

    it('creates an instance directly from the parent-owned item', async () => {
        const instance = await getOrCreateInstance('chat-1', script, 'pipe', 'display', false);
        expect(instance).not.toBeNull();
        const handler = instance?.pipelineHandlers.get('display')?.[0];
        expect(handler).toBeDefined();
        await expect(invokeHandler(instance!, handler!.fnHandle, 'value')).resolves.toBe(
            'value_parent'
        );
    });

    it('does not create instances for disabled items', async () => {
        const instance = await getOrCreateInstance(
            'chat-1',
            { ...script, enabled: false },
            'pipe',
            'display',
            false
        );
        expect(instance).toBeNull();
    });

    it('blocks low-level API calls and identifies the CharJS in a toast', async () => {
        const lowLevelScript: CharJS = {
            ...script,
            code: `KeiAPI.onPipeline('display', async (data) => {
                await KeiAPI.callLLM('aux', []);
                return data;
            });`
        };
        const instance = await getOrCreateInstance(
            'chat-1',
            lowLevelScript,
            'pipe',
            'display',
            false
        );
        const handler = instance?.pipelineHandlers.get('display')?.[0];

        await expect(invokeHandler(instance!, handler!.fnHandle, 'value')).resolves.toBeUndefined();
        expect(get(toastItems)).toEqual([
            expect.objectContaining({
                kind: 'error',
                title: 'Low-level access blocked',
                description: 'CharJS "Parent Script" tried to use a low-level API.'
            })
        ]);
    });

    it('invalidates every cached instance when low-level permission changes', async () => {
        const multiModeScript: CharJS = {
            ...script,
            code: `
                KeiAPI.onPipeline('display', (data) => data);
                KeiAPI.onPipeline('output', (data) => data);
            `
        };
        const displayInstance = await getOrCreateInstance(
            'chat-1',
            multiModeScript,
            'pipe',
            'display',
            false
        );
        const outputInstance = await getOrCreateInstance(
            'chat-1',
            multiModeScript,
            'pipe',
            'output',
            false
        );

        const permittedDisplayInstance = await getOrCreateInstance(
            'chat-1',
            multiModeScript,
            'pipe',
            'display',
            true
        );

        expect(displayInstance?.ctx.alive).toBe(false);
        expect(outputInstance?.ctx.alive).toBe(false);
        expect(permittedDisplayInstance).not.toBe(displayInstance);
        expect(permittedDisplayInstance?.allowLowLevel).toBe(true);
    });

    it('awaits a fulfilled async handler before dumping its result', async () => {
        const asyncScript: CharJS = {
            ...script,
            code: `KeiAPI.onPipeline('display', async (data) => {
                await Promise.resolve();
                return data + '_async';
            });`
        };
        const instance = await getOrCreateInstance('chat-1', asyncScript, 'pipe', 'display', false);
        const handler = instance?.pipelineHandlers.get('display')?.[0];

        await expect(invokeHandler(instance!, handler!.fnHandle, 'value')).resolves.toBe(
            'value_async'
        );
    });

    it('returns undefined without disposing the runtime when an async handler rejects', async () => {
        const rejectingScript: CharJS = {
            ...script,
            code: `KeiAPI.onPipeline('display', async () => {
                await Promise.resolve();
                throw new Error('async failure');
            });`
        };
        const instance = await getOrCreateInstance(
            'chat-1',
            rejectingScript,
            'pipe',
            'display',
            false
        );
        const handler = instance?.pipelineHandlers.get('display')?.[0];

        await expect(invokeHandler(instance!, handler!.fnHandle, 'value')).resolves.toBeUndefined();
        expect(instance?.ctx.alive).toBe(true);
        expect(instance?.runtime.alive).toBe(true);
    });

    it('returns undefined when an async handler exceeds the invocation deadline', async () => {
        const pendingScript: CharJS = {
            ...script,
            code: `KeiAPI.onPipeline('display', () => new Promise(() => {}));`
        };
        const instance = await getOrCreateInstance(
            'chat-1',
            pendingScript,
            'pipe',
            'display',
            false
        );
        const handler = instance?.pipelineHandlers.get('display')?.[0];

        await expect(invokeHandler(instance!, handler!.fnHandle, 'value')).resolves.toBeUndefined();
        expect(instance?.ctx.alive).toBe(true);
    }, 5000);
});
