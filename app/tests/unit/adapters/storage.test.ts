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

        await expect(adapter.getRenderUrl('assets/fallback.bin', 'image/png')).resolves.toBe(
            'blob:fallback'
        );
        const renderedBlob = createObjectURL.mock.calls[0][0];
        expect(renderedBlob).toBeInstanceOf(Blob);
        expect((renderedBlob as Blob).type).toBe('image/png');
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

    it('renders legacy Korean text bytes as UTF-8 plain text', async () => {
        setStorage(undefined);
        const adapter = makeAdapter();
        await adapter.write('assets/korean.md', new Uint8Array([0xbe, 0xc8, 0xb3, 0xe7]));

        const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:korean');
        await adapter.getRenderUrl('assets/korean.md', 'text/plain;charset=utf-8');

        const renderedBlob = createObjectURL.mock.calls[0][0] as Blob;
        expect(renderedBlob.type).toBe('text/plain;charset=utf-8');
        expect(await renderedBlob.text()).toBe('안녕');
    });

    it('re-tags transcoded text blobs as UTF-8 regardless of the declared charset', async () => {
        setStorage(undefined);
        const adapter = makeAdapter();
        await adapter.write('assets/legacy.txt', new Uint8Array([0xbe, 0xc8, 0xb3, 0xe7]));

        const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:legacy');
        await adapter.getRenderUrl('assets/legacy.txt', 'text/plain;charset=euc-kr');

        const renderedBlob = createObjectURL.mock.calls[0][0] as Blob;
        expect(renderedBlob.type).toBe('text/plain;charset=utf-8');
        expect(await renderedBlob.text()).toBe('안녕');
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
