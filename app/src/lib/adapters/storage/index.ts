export * from './types';
import { isTauri } from '@tauri-apps/api/core';
import { WebStorageAdapter } from './web';
import { TauriStorageAdapter } from './tauri';

export const appStorage = isTauri() ? new TauriStorageAdapter() : new WebStorageAdapter();
