export * from './types';

import { isTauri } from '@tauri-apps/api/core';
import { WebUserAdapter } from './web';
import { TauriUserAdapter } from './tauri';

export const appUser = isTauri() ? new TauriUserAdapter() : new WebUserAdapter();
