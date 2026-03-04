export * from './types.js';

import { isTauri } from '@tauri-apps/api/core';
import { WebUserAdapter } from './web.js';
import { TauriUserAdapter } from './tauri.js';

export const appUser = isTauri() ? new TauriUserAdapter() : new WebUserAdapter();
