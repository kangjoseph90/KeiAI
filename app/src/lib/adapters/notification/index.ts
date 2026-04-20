export * from './types';

import { isTauri } from '@tauri-apps/api/core';
import { WebNotificationAdapter } from './web';
import { TauriNotificationAdapter } from './tauri';

export const appNotification = isTauri()
    ? new TauriNotificationAdapter()
    : new WebNotificationAdapter();
