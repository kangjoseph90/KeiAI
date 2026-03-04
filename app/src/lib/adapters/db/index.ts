export * from './types.js';
import { isTauri } from '@tauri-apps/api/core';
import { WebDatabaseAdapter } from './web.js';
import { TauriDatabaseAdapter } from './tauri.js';

export const localDB = isTauri() ? new TauriDatabaseAdapter() : new WebDatabaseAdapter();