import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WebLoggerAdapter } from '$lib/adapters/logger/web';
import { TauriLoggerAdapter } from '$lib/adapters/logger/tauri';

const mockExists = vi.fn();
const mockMkdir = vi.fn();
const mockReadDir = vi.fn();
const mockReadTextFile = vi.fn();
const mockRemove = vi.fn();
const mockWriteTextFile = vi.fn();

vi.mock('@tauri-apps/api/path', () => ({
	BaseDirectory: {
		AppData: 'AppData'
	}
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
	exists: (...args: unknown[]) => mockExists(...args),
	mkdir: (...args: unknown[]) => mockMkdir(...args),
	readDir: (...args: unknown[]) => mockReadDir(...args),
	readTextFile: (...args: unknown[]) => mockReadTextFile(...args),
	remove: (...args: unknown[]) => mockRemove(...args),
	writeTextFile: (...args: unknown[]) => mockWriteTextFile(...args)
}));

async function flushAsync(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('Logger adapters', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('WebLoggerAdapter', () => {
		it('formats namespace logs and routes by level', () => {
			const adapter = new WebLoggerAdapter();
			const logger = adapter.createLogger('sync:data');
			const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
			const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

			logger.warn('pull failed', { code: 500 });
			logger.error('push failed');

			expect(warnSpy).toHaveBeenCalledWith('[KeiAI][WARN][sync:data] pull failed', { code: 500 });
			expect(errorSpy).toHaveBeenCalledWith('[KeiAI][ERROR][sync:data] push failed');
		});

		it('formats logs without namespace', () => {
			const adapter = new WebLoggerAdapter();
			const logger = adapter.createLogger();
			const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

			logger.info('hello');

			expect(infoSpy).toHaveBeenCalledWith('[KeiAI][INFO] hello');
		});
	});

	describe('TauriLoggerAdapter', () => {
		it('writes daily file logs and removes files older than 7 days', async () => {
			mockExists.mockImplementation(async (path: string) => {
				if (path === 'logs') return true;
				return false;
			});
			mockReadDir.mockResolvedValue([
				{ name: '2000-01-01.log', isFile: true, isDirectory: false, isSymlink: false },
				{ name: '2999-01-01.log', isFile: true, isDirectory: false, isSymlink: false }
			]);
			mockWriteTextFile.mockResolvedValue(undefined);
			mockRemove.mockResolvedValue(undefined);

			const adapter = new TauriLoggerAdapter();
			const logger = adapter.createLogger('sync:asset');
			logger.info('sync started');
			await flushAsync();

			expect(mockRemove).toHaveBeenCalledWith('logs/2000-01-01.log', { baseDir: 'AppData' });
			expect(mockWriteTextFile).toHaveBeenCalled();
			const [pathArg, contentArg, optionArg] = mockWriteTextFile.mock.calls[0] as [
				string,
				string,
				{ baseDir: string; append: boolean }
			];
			expect(pathArg.startsWith('logs/')).toBe(true);
			expect(pathArg.endsWith('.log')).toBe(true);
			expect(contentArg).toContain('[INFO][sync:asset] sync started');
			expect(optionArg).toEqual({ baseDir: 'AppData', append: true });
		});

		it('appends to existing daily log file', async () => {
			mockExists.mockImplementation(async (path: string) => {
				if (path === 'logs') return true;
				return false;
			});
			mockReadDir.mockResolvedValue([]);
			mockWriteTextFile.mockResolvedValue(undefined);

			const adapter = new TauriLoggerAdapter();
			const logger = adapter.createLogger();
			logger.error('new line');
			await flushAsync();

			// With append mode, we don't read the file first
			expect(mockReadTextFile).not.toHaveBeenCalled();
			expect(mockWriteTextFile).toHaveBeenCalled();
			const [, contentArg, optionArg] = mockWriteTextFile.mock.calls[0] as [
				string,
				string,
				{ baseDir: string; append: boolean }
			];
			// Only the new line is written (not concatenated with old content)
			expect(contentArg).toContain('[ERROR] new line');
			expect(optionArg).toEqual({ baseDir: 'AppData', append: true });
		});
	});

	describe('logger index dispatch', () => {
		it('uses web logger when isTauri is false', async () => {
			vi.resetModules();
			vi.doMock('@tauri-apps/api/core', () => ({
				isTauri: () => false
			}));

			const { createLogger } = await import('$lib/adapters/logger');
			const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
			createLogger('dispatch').info('ok');

			expect(infoSpy).toHaveBeenCalledWith('[KeiAI][INFO][dispatch] ok');
		});

		it('uses tauri logger when isTauri is true', async () => {
			vi.resetModules();
			vi.doMock('@tauri-apps/api/path', () => ({
				BaseDirectory: {
					AppData: 'AppData'
				}
			}));
			vi.doMock('@tauri-apps/plugin-fs', () => ({
				exists: (...args: unknown[]) => mockExists(...args),
				mkdir: (...args: unknown[]) => mockMkdir(...args),
				readDir: (...args: unknown[]) => mockReadDir(...args),
				readTextFile: (...args: unknown[]) => mockReadTextFile(...args),
				remove: (...args: unknown[]) => mockRemove(...args),
				writeTextFile: (...args: unknown[]) => mockWriteTextFile(...args)
			}));
			vi.doMock('@tauri-apps/api/core', () => ({
				isTauri: () => true
			}));

			mockExists.mockResolvedValue(false);
			mockMkdir.mockResolvedValue(undefined);
			mockReadDir.mockResolvedValue([]);
			mockWriteTextFile.mockResolvedValue(undefined);

			const { createLogger } = await import('$lib/adapters/logger');
			createLogger('dispatch').warn('ok');
			await flushAsync();

			expect(mockWriteTextFile).toHaveBeenCalled();
		});
	});
});
