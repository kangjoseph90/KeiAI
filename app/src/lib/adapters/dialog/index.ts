export * from './types';

import { isTauri } from '@tauri-apps/api/core';
import { WebDialogAdapter } from './web';
import { TauriDialogAdapter } from './tauri';

export const appDialog = isTauri() ? new TauriDialogAdapter() : new WebDialogAdapter();
