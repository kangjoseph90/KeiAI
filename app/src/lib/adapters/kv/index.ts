export * from './types';

import { isTauri } from '@tauri-apps/api/core';
import { LocalStorageKeyValueStore, WebKeyValueAdapter } from './web';
import { TauriKeyValueAdapter } from './tauri';

export const deviceKV = new LocalStorageKeyValueStore();
export const appKV = isTauri() ? new TauriKeyValueAdapter() : new WebKeyValueAdapter();
