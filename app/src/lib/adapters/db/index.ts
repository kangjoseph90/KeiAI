export * from './types.js';
import { isTauri } from '@tauri-apps/api/core';
import { WebDatabaseAdapter } from './web.js';

// TODO: add tauri adapter
export const localDB = new WebDatabaseAdapter();