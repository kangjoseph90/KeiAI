import { describe, expect, it } from 'vitest';
import { acquireInferenceLease, runInferenceCacheMutation } from '$lib/inference/cache-coordinator';

describe('inference cache coordinator', () => {
    it('waits for active inference before mutating the cache', async () => {
        const release = await acquireInferenceLease();
        let mutated = false;
        const mutation = runInferenceCacheMutation(async () => {
            mutated = true;
        });

        await Promise.resolve();
        expect(mutated).toBe(false);

        release();
        await mutation;
        expect(mutated).toBe(true);
    });

    it('blocks new inference until a cache mutation finishes', async () => {
        let finishMutation: () => void = () => undefined;
        const mutation = runInferenceCacheMutation(
            () => new Promise<void>((resolve) => (finishMutation = resolve))
        );
        await Promise.resolve();

        let acquired = false;
        const lease = acquireInferenceLease().then((release) => {
            acquired = true;
            return release;
        });
        await Promise.resolve();
        expect(acquired).toBe(false);

        finishMutation();
        await mutation;
        const release = await lease;
        expect(acquired).toBe(true);
        release();
    });

    it('rejects an aborted inference while it waits for a cache mutation', async () => {
        let finishMutation: () => void = () => undefined;
        const mutation = runInferenceCacheMutation(
            () => new Promise<void>((resolve) => (finishMutation = resolve))
        );
        await Promise.resolve();
        const controller = new AbortController();
        const lease = acquireInferenceLease(controller.signal);

        controller.abort();
        await expect(lease).rejects.toMatchObject({ name: 'AbortError' });
        finishMutation();
        await mutation;
    });
});
