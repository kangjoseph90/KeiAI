export * from './types';
import { isTauri } from '@tauri-apps/api/core';
import { WebDatabaseAdapter } from './web';
import { TauriDatabaseAdapter } from './tauri';

export const localDB = isTauri() ? new TauriDatabaseAdapter() : new WebDatabaseAdapter();
