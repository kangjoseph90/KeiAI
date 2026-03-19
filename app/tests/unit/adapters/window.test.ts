import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebWindowAdapter } from '$lib/adapters/window/web';
import { TauriWindowAdapter } from '$lib/adapters/window/tauri';
import { getCurrentWindow } from '@tauri-apps/api/window';

vi.mock('@tauri-apps/api/window', () => ({
	getCurrentWindow: vi.fn()
}));

describe('Window Adapters', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('WebWindowAdapter', () => {
		let adapter: WebWindowAdapter;
		const originalClose = window.close;

		beforeEach(() => {
			adapter = new WebWindowAdapter();
			window.close = vi.fn();
			vi.spyOn(console, 'warn').mockImplementation(() => {});
		});

		afterEach(() => {
			window.close = originalClose;
		});

		it('setTitle should change document title', async () => {
			await adapter.setTitle('My New Web Title');
			expect(document.title).toBe('My New Web Title');
		});

		it('close should call window.close and issue a warn', async () => {
			await adapter.close();
			expect(window.close).toHaveBeenCalled();
			expect(console.warn).toHaveBeenCalledWith(
				expect.stringContaining('[KeiAI][WARN][adapter:window:web] Window close may not work')
			);
		});

		it('minimize/maximize/unmaximize/setAlwaysOnTop should all issue warnings', async () => {
			await adapter.minimize();
			await adapter.maximize();
			await adapter.unmaximize();
			await adapter.setAlwaysOnTop(true);

			expect(console.warn).toHaveBeenCalledTimes(4);
		});
	});

	describe('TauriWindowAdapter', () => {
		let adapter: TauriWindowAdapter;
		const mockWindowInstance = {
			minimize: vi.fn(),
			maximize: vi.fn(),
			unmaximize: vi.fn(),
			close: vi.fn(),
			setTitle: vi.fn(),
			setAlwaysOnTop: vi.fn()
		};

		beforeEach(() => {
			adapter = new TauriWindowAdapter();
			vi.mocked(getCurrentWindow).mockReturnValue(mockWindowInstance as never);
		});

		it('minimize should call plugin minimize', async () => {
			await adapter.minimize();
			expect(mockWindowInstance.minimize).toHaveBeenCalled();
		});

		it('maximize should call plugin maximize', async () => {
			await adapter.maximize();
			expect(mockWindowInstance.maximize).toHaveBeenCalled();
		});

		it('unmaximize should call plugin unmaximize', async () => {
			await adapter.unmaximize();
			expect(mockWindowInstance.unmaximize).toHaveBeenCalled();
		});

		it('close should call plugin close', async () => {
			await adapter.close();
			expect(mockWindowInstance.close).toHaveBeenCalled();
		});

		it('setTitle should call plugin setTitle', async () => {
			await adapter.setTitle('New Tauri Title');
			expect(mockWindowInstance.setTitle).toHaveBeenCalledWith('New Tauri Title');
		});

		it('setAlwaysOnTop should call plugin setAlwaysOnTop', async () => {
			await adapter.setAlwaysOnTop(true);
			expect(mockWindowInstance.setAlwaysOnTop).toHaveBeenCalledWith(true);
		});
	});
});
