import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebHttpAdapter } from '$lib/adapters/http/web';
import { TauriHttpAdapter } from '$lib/adapters/http/tauri';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

// Mock Tauri HTTP Plugin
vi.mock('@tauri-apps/plugin-http', () => ({
	fetch: vi.fn()
}));

const mockResponse = (data: unknown, ok = true, status = 200) =>
	({
		ok,
		status,
		json: vi.fn().mockResolvedValue(data)
	}) as unknown as Response;

describe('HTTP Adapters', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('WebHttpAdapter', () => {
		let adapter: WebHttpAdapter;

		beforeEach(() => {
			adapter = new WebHttpAdapter();
			global.fetch = vi.fn();
		});

		it('get() should make a fetch call and return parsed json', async () => {
			vi.mocked(global.fetch).mockResolvedValue(mockResponse({ message: 'success' }));

			const result = await adapter.get<{ message: string }>('https://api.example.com/data');
			expect(global.fetch).toHaveBeenCalledWith('https://api.example.com/data', {
				headers: undefined
			});
			expect(result.message).toBe('success');
		});

		it('post() should attach correct headers and body', async () => {
			vi.mocked(global.fetch).mockResolvedValue(mockResponse({ created: true }));

			const result = await adapter.post<{ created: boolean }>('https://api.example.com/data', {
				foo: 'bar'
			});
			expect(global.fetch).toHaveBeenCalledWith('https://api.example.com/data', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ foo: 'bar' })
			});
			expect(result.created).toBe(true);
		});

		it('should throw HttpError on non-ok status', async () => {
			vi.mocked(global.fetch).mockResolvedValue(mockResponse(null, false, 404));
			await expect(adapter.get('https://api.example.com/data')).rejects.toThrow('HTTP Error: 404');
		});
	});

	describe('TauriHttpAdapter', () => {
		let adapter: TauriHttpAdapter;

		beforeEach(() => {
			adapter = new TauriHttpAdapter();
		});

		it('get() should make a plugin fetch call', async () => {
			vi.mocked(tauriFetch).mockResolvedValue(mockResponse({ message: 'tauri-success' }));

			const result = await adapter.get<{ message: string }>('https://api.example.com/data');
			expect(tauriFetch).toHaveBeenCalledWith('https://api.example.com/data', {
				headers: undefined
			});
			expect(result.message).toBe('tauri-success');
		});

		it('post() should make a plugin fetch call with right configuration', async () => {
			vi.mocked(tauriFetch).mockResolvedValue(mockResponse({ tauriReady: true }));

			const result = await adapter.post<{ tauriReady: boolean }>('https://api.example.com/data', {
				baz: 'qux'
			});
			expect(tauriFetch).toHaveBeenCalledWith('https://api.example.com/data', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ baz: 'qux' })
			});
			expect(result.tauriReady).toBe(true);
		});

		it('should propagate raw error if tauriFetch throws', async () => {
			vi.mocked(tauriFetch).mockRejectedValue(new Error('Connection failed'));
			await expect(adapter.get('https://api.example.com/data')).rejects.toThrow(
				'Connection failed'
			);
		});
	});
});
