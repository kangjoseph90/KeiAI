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
            vi.useRealTimers();
            vi.restoreAllMocks();
        });

        it('openFile should resolve the selected file on web', async () => {
            const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });
            let picker: HTMLInputElement | null = null;
            mockInputSelection([file], (input) => (picker = input));

            const result = await adapter.openFile({
                filters: [{ name: 'Text', extensions: ['txt'] }]
            });

            expect(result).toBe(file);
            expect(picker).not.toBeNull();
            expect(picker!.multiple).toBe(false);
            expect(picker!.accept).toBe('.txt');
            expect(picker!.isConnected).toBe(false);
        });

        it('openMultipleFiles should resolve selected files', async () => {
            const files = [new File(['a'], 'a.txt'), new File(['b'], 'b.txt')];
            let picker: HTMLInputElement | null = null;
            mockInputSelection(files, (input) => (picker = input));

            const result = await adapter.openMultipleFiles();
            expect(result).toEqual(files);
            expect(picker).not.toBeNull();
            expect(picker!.multiple).toBe(true);
            expect(picker!.isConnected).toBe(false);
        });

        it('cleans up the picker when selection is cancelled', async () => {
            let picker: HTMLInputElement | null = null;
            mockInputCancel((input) => (picker = input));

            const result = await adapter.openFile();

            expect(result).toBeNull();
            expect(picker).not.toBeNull();
            expect(picker!.isConnected).toBe(false);
        });

        it('treats focus return without a selection as cancellation', async () => {
            vi.useFakeTimers();
            mockInputFocusReturn();

            const pending = adapter.openFile();
            await vi.advanceTimersByTimeAsync(150);

            await expect(pending).resolves.toBeNull();
        });

        it('saveBytes should trigger a browser download', async () => {
            vi.useFakeTimers();
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
            expect(anchor.isConnected).toBe(false);
            expect(revokeObjectURL).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(1_000);
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

        it('recovers image metadata from an Android content URI', async () => {
            vi.mocked(open).mockResolvedValue('content://media/images/image%3A42');
            vi.mocked(readFile).mockResolvedValue(
                new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
            );

            const result = await adapter.openFile();

            expect(result?.name).toBe('image:42.png');
            expect(result?.type).toBe('image/png');
            expect(readFile).toHaveBeenCalledWith('content://media/images/image%3A42');
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

function mockInputSelection(files: File[], onCreate?: (input: HTMLInputElement) => void): void {
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
        const element = originalCreateElement(tagName);
        if (tagName !== 'input') return element;

        const input = element as HTMLInputElement;
        onCreate?.(input);
        Object.defineProperty(element, 'files', {
            configurable: true,
            value: files
        });
        element.click = vi.fn(() => {
            setTimeout(() => {
                element.dispatchEvent(new Event('change'));
            }, 0);
        });
        return element;
    });
}

function mockInputCancel(onCreate?: (input: HTMLInputElement) => void): void {
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
        const element = originalCreateElement(tagName);
        if (tagName !== 'input') return element;

        const input = element as HTMLInputElement;
        onCreate?.(input);
        input.click = vi.fn(() => {
            setTimeout(() => input.dispatchEvent(new Event('cancel')), 0);
        });
        return input;
    });
}

function mockInputFocusReturn(): void {
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
        const element = originalCreateElement(tagName);
        if (tagName !== 'input') return element;

        element.click = vi.fn(() => window.dispatchEvent(new Event('focus')));
        return element;
    });
}
