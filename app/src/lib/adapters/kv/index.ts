export * from './types';

import { isTauri } from '@tauri-apps/api/core';
import { WebKeyValueAdapter } from './web';
import { TauriKeyValueAdapter } from './tauri';

export const appKV = isTauri() ? new TauriKeyValueAdapter() : new WebKeyValueAdapter();
