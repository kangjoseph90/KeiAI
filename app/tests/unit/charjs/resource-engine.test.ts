import { afterEach, describe, expect, it } from 'vitest';
import { destroyAllInstances, getOrCreateInstance, invokeHandler } from '$lib/charjs';
import type { CharJS } from '$lib/services';

const script: CharJS = {
    id: 'parent-script',
    sortOrder: 'a',
    name: 'Parent Script',
    enabled: true,
    code: `KeiAPI.onPipeline('display', (data) => data + '_parent');`
};

describe('parent-owned CharJS engine', () => {
    afterEach(() => destroyAllInstances());

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
});
