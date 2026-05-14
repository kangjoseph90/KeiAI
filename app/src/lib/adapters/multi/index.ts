export * from './types';

import { isTauri } from '@tauri-apps/api/core';
import { WebMultiAdapter } from './web';
import { TauriMultiAdapter } from './tauri';

export const appMulti = isTauri() ? new TauriMultiAdapter() : new WebMultiAdapter();
