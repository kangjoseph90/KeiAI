export * from './types';

import { isTauri } from '@tauri-apps/api/core';
import { TauriSyncCursorAdapter } from './tauri';
import { WebSyncCursorAdapter } from './web';

export const syncCursorDB = isTauri() ? new TauriSyncCursorAdapter() : new WebSyncCursorAdapter();
