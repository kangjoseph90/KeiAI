import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import {
    dismissPorterOperation,
    porterOperation,
    runPorterOperation,
    type PorterOperationState
} from '$lib/ui/porter-operation';

const META = { kind: 'export', entity: 'character' } as const;

describe('runPorterOperation', () => {
    beforeEach(() => {
        porterOperation.set(null);
    });

    it('opens the dialog on the first report and closes it on success', async () => {
        const result = await runPorterOperation(META, async (onProgress) => {
            onProgress({ phase: 'preparing', completed: 0, total: 0 });
            onProgress({ phase: 'processing-assets', completed: 1, total: 2 });
            return 'done';
        });

        expect(result).toBe('done');
        expect(get(porterOperation)).toBeNull();
    });

    it('never opens the dialog when the operation reports nothing', async () => {
        const result = await runPorterOperation(META, async () => null);

        expect(result).toBeNull();
        expect(get(porterOperation)).toBeNull();
    });

    it('keeps the failed state with the last phase until dismissed', async () => {
        const result = await runPorterOperation(META, async (onProgress) => {
            onProgress({ phase: 'preparing', completed: 0, total: 0 });
            onProgress({ phase: 'processing-assets', completed: 1, total: 3 });
            throw new Error('asset upload failed');
        });

        expect(result).toBeUndefined();
        expect(get(porterOperation)).toEqual({
            kind: 'export',
            entity: 'character',
            phase: 'processing-assets',
            completed: 1,
            total: 3,
            error: 'asset upload failed'
        } satisfies PorterOperationState);

        dismissPorterOperation();
        expect(get(porterOperation)).toBeNull();
    });

    it('rethrows failures that happen before the first report', async () => {
        const operation = vi.fn(async () => {
            throw new Error('picker failed');
        });

        await expect(runPorterOperation(META, operation)).rejects.toThrow('picker failed');
        expect(get(porterOperation)).toBeNull();
    });

    it('rejects a second operation while one is active', async () => {
        let finishFirst: (value: string) => void = () => undefined;
        const first = runPorterOperation(META, (onProgress) => {
            onProgress({ phase: 'preparing', completed: 0, total: 0 });
            return new Promise<string>((resolve) => {
                finishFirst = resolve;
            });
        });
        expect(get(porterOperation)?.phase).toBe('preparing');

        const second = await runPorterOperation({ kind: 'import', entity: 'module' }, vi.fn());
        expect(second).toBeUndefined();

        finishFirst('ok');
        await expect(first).resolves.toBe('ok');
        expect(get(porterOperation)).toBeNull();
    });
});
