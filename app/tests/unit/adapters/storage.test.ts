import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebStorageAdapter } from '$lib/adapters/storage/web';

const originalStorageDescriptor = Object.getOwnPropertyDescriptor(navigator, 'storage');
let databaseIndex = 0;

afterEach(() => {
    if (originalStorageDescriptor) {
        Object.defineProperty(navigator, 'storage', originalStorageDescriptor);
    } else {
        Reflect.deleteProperty(navigator, 'storage');
    }
    vi.restoreAllMocks();
});

describe('WebStorageAdapter', () => {
    it('falls back to IndexedDB when OPFS is not exposed', async () => {
        setStorage(undefined);
        const adapter = makeAdapter();
        const bytes = new Uint8Array([1, 2, 3, 4]);

        await adapter.write('assets/fallback.bin', bytes);

        expect(await adapter.exists('assets/fallback.bin')).toBe(true);
        expect(await adapter.getSize('assets/fallback.bin')).toBe(4);
        expect(await adapter.read('assets/fallback.bin')).toEqual(bytes);

        const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fallback');
        const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

        await expect(adapter.getRenderUrl('assets/fallback.bin')).resolves.toBe('blob:fallback');
        expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
        await adapter.revokeRenderUrl('blob:fallback');
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:fallback');

        await adapter.delete('assets/fallback.bin');
        expect(await adapter.exists('assets/fallback.bin')).toBe(false);
        expect(await adapter.read('assets/fallback.bin')).toBeNull();
    });

    it('falls back when OPFS initialization is rejected and caches that decision', async () => {
        const getDirectory = vi
            .fn<() => Promise<FileSystemDirectoryHandle>>()
            .mockRejectedValue(new DOMException('OPFS denied', 'NotAllowedError'));
        setStorage({ getDirectory });
        const adapter = makeAdapter();

        await adapter.write('assets/rejected.bin', new Blob([new Uint8Array([9, 8, 7])]));

        expect(await adapter.read('assets/rejected.bin')).toEqual(new Uint8Array([9, 8, 7]));
        expect(await adapter.getSize('assets/rejected.bin')).toBe(3);
        expect(getDirectory).toHaveBeenCalledTimes(1);
    });
});

function makeAdapter(): WebStorageAdapter {
    databaseIndex += 1;
    return new WebStorageAdapter(`KeiStorageTest-${databaseIndex}`);
}

function setStorage(storage: Pick<StorageManager, 'getDirectory'> | undefined): void {
    Object.defineProperty(navigator, 'storage', {
        configurable: true,
        value: storage
    });
}
