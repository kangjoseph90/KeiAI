export * from './types';

import { isTauri } from '@tauri-apps/api/core';
import { WebClipboardAdapter } from './web';
import { TauriClipboardAdapter } from './tauri';

export const appClipboard = isTauri() ? new TauriClipboardAdapter() : new WebClipboardAdapter();
