import { openUrl } from '@tauri-apps/plugin-opener';
import { AppError } from '$lib/types/errors';
import type { IExternalAdapter } from './types';
import { normalizeExternalUrl } from './types';

export class TauriExternalAdapter implements IExternalAdapter {
    async openUrl(value: string): Promise<void> {
        try {
            await openUrl(normalizeExternalUrl(value));
        } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError('WINDOW_ERROR', 'Could not open the link.', error);
        }
    }
}
