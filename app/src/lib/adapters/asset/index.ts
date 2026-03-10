export * from './types';

import { isTauri } from '@tauri-apps/api/core';
import { WebAssetAdapter } from './web';
import { TauriAssetAdapter } from './tauri';

// SQLite for metadata on Tauri, IndexedDB on Web.
// Binary blobs use appStorage (OPFS or native FS) on both platforms.
export const appAsset = isTauri() ? new TauriAssetAdapter() : new WebAssetAdapter();
