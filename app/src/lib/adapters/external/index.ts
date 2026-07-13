export * from './types';

import { isTauri } from '@tauri-apps/api/core';
import { TauriExternalAdapter } from './tauri';
import { WebExternalAdapter } from './web';

export const appExternal = isTauri() ? new TauriExternalAdapter() : new WebExternalAdapter();
