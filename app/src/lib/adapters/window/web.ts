import type { IWindowAdapter } from './types';
import { createLogger } from '$lib/adapters/logger';

const logger = createLogger('adapter:window:web');

/**
 * Web Window Adapter
 *
 * Provides fallback implementations for the browser environment.
 * The web cannot natively minimize, maximize, or set always on top.
 */
export class WebWindowAdapter implements IWindowAdapter {
    async minimize(): Promise<void> {
        logger.warn('Window minimization is not supported on the web.');
    }

    async maximize(): Promise<void> {
        logger.warn('Window maximization is not supported on the web.');
    }

    async unmaximize(): Promise<void> {
        logger.warn('Window unmaximization is not supported on the web.');
    }

    async close(): Promise<void> {
        window.close();
        logger.warn('Window close may not work on the web unless the script opened the window.');
    }

    async setTitle(title: string): Promise<void> {
        document.title = title;
    }

    async setAlwaysOnTop(_alwaysOnTop: boolean): Promise<void> {
        logger.warn('setAlwaysOnTop is not supported on the web.');
    }
}

export const webWindow = new WebWindowAdapter();
