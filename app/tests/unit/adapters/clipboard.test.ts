import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebClipboardAdapter } from '$lib/adapters/clipboard/web';
import { TauriClipboardAdapter } from '$lib/adapters/clipboard/tauri';
import { readText, writeText, readImage } from '@tauri-apps/plugin-clipboard-manager';
import { AppError } from '$lib/types/errors';

vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
    readText: vi.fn(),
    writeText: vi.fn(),
    readImage: vi.fn()
}));

describe('Clipboard Adapters', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('WebClipboardAdapter', () => {
        let adapter: WebClipboardAdapter;
        const mockClipboard = {
            readText: vi.fn(),
            writeText: vi.fn(),
            read: vi.fn(),
            write: vi.fn()
        };

        beforeEach(() => {
            adapter = new WebClipboardAdapter();
            vi.stubGlobal('navigator', {
                ...global.navigator,
                clipboard: mockClipboard
            });

            // Mock ClipboardItem for the image writing
            global.ClipboardItem = vi.fn().mockImplementation(function (config) {
                return config;
            }) as unknown as typeof ClipboardItem;

            global.Blob = vi.fn().mockImplementation(function (content, options) {
                return { content, options };
            }) as unknown as typeof Blob;
        });

        afterEach(() => {
            vi.unstubAllGlobals();
        });

        it('readText should map to navigator.clipboard', async () => {
            mockClipboard.readText.mockResolvedValue('Copied text');
            const result = await adapter.readText();
            expect(mockClipboard.readText).toHaveBeenCalled();
            expect(result).toBe('Copied text');
        });

        it('writeText should map to navigator.clipboard', async () => {
            mockClipboard.writeText.mockResolvedValue(undefined);
            await adapter.writeText('Writing text');
            expect(mockClipboard.writeText).toHaveBeenCalledWith('Writing text');
        });

        it('readImage should parse items and return Uint8Array', async () => {
            const mockBlob = {
                arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(4))
            };
            const mockItem = {
                types: ['image/png'],
                getType: vi.fn().mockResolvedValue(mockBlob)
            };
            mockClipboard.read.mockResolvedValue([mockItem]);

            const result = await adapter.readImage();
            expect(mockClipboard.read).toHaveBeenCalled();
            expect(result).toBeInstanceOf(Uint8Array);
        });

        it('writeImage should create ClipboardItem and call write', async () => {
            const data = new Uint8Array([1, 2, 3]);
            await adapter.writeImage(data);
            expect(mockClipboard.write).toHaveBeenCalled();
            expect(global.ClipboardItem).toHaveBeenCalled();
        });
    });

    describe('TauriClipboardAdapter', () => {
        let adapter: TauriClipboardAdapter;

        beforeEach(() => {
            adapter = new TauriClipboardAdapter();
        });

        it('readText should map to plugin readText', async () => {
            vi.mocked(readText).mockResolvedValue('Tauri text');
            const result = await adapter.readText();
            expect(readText).toHaveBeenCalled();
            expect(result).toBe('Tauri text');
        });

        it('writeText should map to plugin writeText', async () => {
            await adapter.writeText('Saving tauri text');
            expect(writeText).toHaveBeenCalledWith('Saving tauri text');
        });

        it('readImage should coerce the Image object and await rgba bytes', async () => {
            const mockBytes = new Uint8Array([255, 0, 0, 255]);
            // The plugin readImage returns an object with a method rgba() resolving to bytes
            const mockImageObj = {
                rgba: vi.fn().mockResolvedValue(mockBytes)
            };
            vi.mocked(readImage).mockResolvedValue(mockImageObj as never);

            const result = await adapter.readImage();
            expect(mockImageObj.rgba).toHaveBeenCalled();
            expect(result).toEqual(new Uint8Array([255, 0, 0, 255]));
        });

        it('writeImage should throw NOT_IMPLEMENTED error', async () => {
            const data = new Uint8Array([1, 2, 3]);
            await expect(adapter.writeImage(data)).rejects.toThrow(AppError);
            await expect(adapter.writeImage(data)).rejects.toMatchObject({
                code: 'NOT_IMPLEMENTED'
            });
        });
    });
});
