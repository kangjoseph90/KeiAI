import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { appConfirm } from '$lib/ui/modal';
import { modalQueue } from '$lib/ui/state';

describe('appConfirm', () => {
    beforeEach(() => modalQueue.set([]));

    it('removes and settles an approval modal when its signal is aborted', async () => {
        const controller = new AbortController();
        const result = appConfirm({ title: 'Approve tool' }, controller.signal);
        expect(get(modalQueue)).toHaveLength(1);

        controller.abort();

        await expect(result).resolves.toBe(false);
        expect(get(modalQueue)).toEqual([]);
    });
});
