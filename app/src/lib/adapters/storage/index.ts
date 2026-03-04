export * from './types.js';
import { isTauri } from '@tauri-apps/api/core';
import { WebStorageAdapter } from './web.js';
import { TauriStorageAdapter } from './tauri.js';

export const appStorage = isTauri() ? new TauriStorageAdapter() : new WebStorageAdapter();