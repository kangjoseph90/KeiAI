import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebDialogAdapter } from '$lib/adapters/dialog/web';
import { TauriDialogAdapter } from '$lib/adapters/dialog/tauri';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readFile, writeFile } from '@tauri-apps/plugin-fs';

vi.mock('@tauri-apps/plugin-dialog', () => ({
    open: vi.fn(),
    save: vi.fn()
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
    readFile: vi.fn(),
    writeFile: vi.fn()
}));

describe('Dialog Adapters', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('WebDialogAdapter', () => {
        let adapter: WebDialogAdapter;

        beforeEach(() => {
            adapter = new WebDialogAdapter();
        });

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('openFile should resolve the selected file on web', async () => {
            const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });
            mockInputSelection([file]);

            const result = await adapter.openFile({
                filters: [{ name: 'Text', extensions: ['txt'] }]
            });

            expect(result).toBe(file);
        });

        it('openMultipleFiles should resolve selected files', async () => {
            const files = [new File(['a'], 'a.txt'), new File(['b'], 'b.txt')];
            mockInputSelection(files);

            const result = await adapter.openMultipleFiles();
            expect(result).toEqual(files);
        });

        it('saveBytes should trigger a browser download', async () => {
            const originalCreateElement = document.createElement.bind(document);
            const anchor = document.createElement('a');
            const click = vi.fn();
            anchor.click = click;
            const createElement = vi.spyOn(document, 'createElement');
            createElement.mockImplementation((tagName: string) => {
                if (tagName === 'a') return anchor;
                return originalCreateElement(tagName);
            });
            const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
            const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

            const result = await adapter.saveBytes({
                bytes: new Uint8Array([1, 2, 3]),
                fileName: 'test.bin',
                mimeType: 'application/octet-stream'
            });

            expect(result).toBe(true);
            expect(anchor.download).toBe('test.bin');
            expect(anchor.href).toBe('blob:test');
            expect(click).toHaveBeenCalled();
            expect(createObjectURL).toHaveBeenCalled();
            expect(revokeObjectURL).toHaveBeenCalledWith('blob:test');
        });
    });

    describe('TauriDialogAdapter', () => {
        let adapter: TauriDialogAdapter;

        beforeEach(() => {
            adapter = new TauriDialogAdapter();
        });

        it('openFile should map to tauri open() with proper options', async () => {
            vi.mocked(open).mockResolvedValue('/path/to/file.png');
            vi.mocked(readFile).mockResolvedValue(new Uint8Array([1, 2, 3]));
            const result = await adapter.openFile({ title: 'Pick Image', defaultPath: '/home' });

            expect(open).toHaveBeenCalledWith(
                expect.objectContaining({
                    multiple: false,
                    directory: false,
                    title: 'Pick Image',
                    defaultPath: '/home'
                })
            );
            expect(result?.name).toBe('file.png');
            expect(result?.type).toBe('image/png');
            expect(readFile).toHaveBeenCalledWith('/path/to/file.png');
        });

        it('openMultipleFiles should map to tauri open() with multiple: true', async () => {
            vi.mocked(open).mockResolvedValue(['/file1.png', '/file2.png']);
            vi.mocked(readFile).mockResolvedValue(new Uint8Array([1, 2, 3]));
            const result = await adapter.openMultipleFiles({ title: 'Pick Images' });

            expect(open).toHaveBeenCalledWith(
                expect.objectContaining({
                    multiple: true,
                    directory: false,
                    title: 'Pick Images'
                })
            );
            expect(result?.map((file) => file.name)).toEqual(['file1.png', 'file2.png']);
        });

        it('saveBytes should map to tauri save() and writeFile()', async () => {
            vi.mocked(save).mockResolvedValue('/path/to/save.png');
            const bytes = new Uint8Array([1, 2, 3]);
            const result = await adapter.saveBytes({
                title: 'Save Image',
                fileName: 'save.png',
                mimeType: 'image/png',
                bytes
            });

            expect(save).toHaveBeenCalledWith(
                expect.objectContaining({
                    title: 'Save Image',
                    defaultPath: 'save.png'
                })
            );
            expect(writeFile).toHaveBeenCalledWith('/path/to/save.png', bytes);
            expect(result).toBe(true);
        });
    });
});

function mockInputSelection(files: File[]): void {
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
        const element = originalCreateElement(tagName);
        if (tagName !== 'input') return element;

        Object.defineProperty(element, 'files', {
            configurable: true,
            value: files
        });
        element.click = vi.fn(() => {
            setTimeout(() => {
                (element as HTMLInputElement).onchange?.(new Event('change'));
            }, 0);
        });
        return element;
    });
}
