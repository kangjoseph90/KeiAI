export * from './types';

import { isTauri } from '@tauri-apps/api/core';
import { WebHttpAdapter } from './web';
import { TauriHttpAdapter } from './tauri';

export const appHttp = isTauri() ? new TauriHttpAdapter() : new WebHttpAdapter();
