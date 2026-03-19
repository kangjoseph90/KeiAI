export * from './types';

import { isTauri } from '@tauri-apps/api/core';
import { WebLoggerAdapter } from './web';
import { TauriLoggerAdapter } from './tauri';

const loggerAdapter = isTauri() ? new TauriLoggerAdapter() : new WebLoggerAdapter();

export const createLogger = (namespace?: string) => loggerAdapter.createLogger(namespace);
