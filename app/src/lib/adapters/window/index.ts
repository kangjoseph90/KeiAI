export * from './types';

import { isTauri } from '@tauri-apps/api/core';
import { WebWindowAdapter } from './web';
import { TauriWindowAdapter } from './tauri';

export const appWindow = isTauri() ? new TauriWindowAdapter() : new WebWindowAdapter();
