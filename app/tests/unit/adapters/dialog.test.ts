import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebDialogAdapter } from '$lib/adapters/dialog/web';
import { TauriDialogAdapter } from '$lib/adapters/dialog/tauri';
import { open, save, message, confirm } from '@tauri-apps/plugin-dialog';

vi.mock('@tauri-apps/plugin-dialog', () => ({
	open: vi.fn(),
	save: vi.fn(),
	message: vi.fn(),
	confirm: vi.fn()
}));

describe('Dialog Adapters', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('WebDialogAdapter', () => {
		let adapter: WebDialogAdapter;
		const originalAlert = global.alert;
		const originalConfirm = global.confirm;

		beforeEach(() => {
			adapter = new WebDialogAdapter();
			global.alert = vi.fn();
			global.confirm = vi.fn();
		});

		afterEach(() => {
			global.alert = originalAlert;
			global.confirm = originalConfirm;
		});

		it('openFile should return null on web', async () => {
			const result = await adapter.openFile();
			expect(result).toBeNull();
		});

		it('openMultipleFiles should return null', async () => {
			const result = await adapter.openMultipleFiles();
			expect(result).toBeNull();
		});

		it('saveFile should return null', async () => {
			const result = await adapter.saveFile();
			expect(result).toBeNull();
		});

		it('message should call window.alert', async () => {
			await adapter.message('Hello World!');
			expect(global.alert).toHaveBeenCalledWith('Hello World!');
		});

		it('confirm should call window.confirm and return its evaluation', async () => {
			vi.mocked(global.confirm).mockReturnValue(true);
			const result = await adapter.confirm('Are you sure?');
			expect(global.confirm).toHaveBeenCalledWith('Are you sure?');
			expect(result).toBe(true);
		});
	});

	describe('TauriDialogAdapter', () => {
		let adapter: TauriDialogAdapter;

		beforeEach(() => {
			adapter = new TauriDialogAdapter();
		});

		it('openFile should map to tauri open() with proper options', async () => {
			vi.mocked(open).mockResolvedValue('/path/to/file.png');
			const result = await adapter.openFile({ title: 'Pick Image', defaultPath: '/home' });

			expect(open).toHaveBeenCalledWith(
				expect.objectContaining({
					multiple: false,
					directory: false,
					title: 'Pick Image',
					defaultPath: '/home'
				})
			);
			expect(result).toBe('/path/to/file.png');
		});

		it('openMultipleFiles should map to tauri open() with multiple: true', async () => {
			vi.mocked(open).mockResolvedValue(['/file1.png', '/file2.png']);
			const result = await adapter.openMultipleFiles({ title: 'Pick Images' });

			expect(open).toHaveBeenCalledWith(
				expect.objectContaining({
					multiple: true,
					directory: false,
					title: 'Pick Images'
				})
			);
			expect(result).toEqual(['/file1.png', '/file2.png']);
		});

		it('saveFile should map to tauri save()', async () => {
			vi.mocked(save).mockResolvedValue('/path/to/save.png');
			const result = await adapter.saveFile({ title: 'Save Image' });

			expect(save).toHaveBeenCalledWith(
				expect.objectContaining({
					title: 'Save Image'
				})
			);
			expect(result).toBe('/path/to/save.png');
		});

		it('message should map to plugin message()', async () => {
			await adapter.message('Done!', 'Success');
			expect(message).toHaveBeenCalledWith('Done!', { title: 'Success' });
		});

		it('confirm should map to plugin confirm()', async () => {
			vi.mocked(confirm).mockResolvedValue(false);
			const result = await adapter.confirm('Delete?', 'Warning');
			expect(confirm).toHaveBeenCalledWith('Delete?', { title: 'Warning' });
			expect(result).toBe(false);
		});
	});
});
