export * from './types.js';

import { isTauri } from '@tauri-apps/api/core';
import { WebKeyValueAdapter } from './web.js';
import { TauriKeyValueAdapter } from './tauri.js';

export const appKV = isTauri() ? new TauriKeyValueAdapter() : new WebKeyValueAdapter();
