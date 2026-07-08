import { getCurrentWindow } from '@tauri-apps/api/window';
import type { IWindowAdapter } from './types';

/**
 * Tauri Window Adapter
 *
 * Uses `@tauri-apps/api/window` to control the native OS window.
 */
export class TauriWindowAdapter implements IWindowAdapter {
    async minimize(): Promise<void> {
        await getCurrentWindow().minimize();
    }

    async maximize(): Promise<void> {
        await getCurrentWindow().maximize();
    }

    async unmaximize(): Promise<void> {
        await getCurrentWindow().unmaximize();
    }

    async close(): Promise<void> {
        await getCurrentWindow().close();
    }

    async reload(): Promise<void> {
        globalThis.location.reload();
    }

    async setTitle(title: string): Promise<void> {
        await getCurrentWindow().setTitle(title);
    }

    async setAlwaysOnTop(alwaysOnTop: boolean): Promise<void> {
        await getCurrentWindow().setAlwaysOnTop(alwaysOnTop);
    }
}
