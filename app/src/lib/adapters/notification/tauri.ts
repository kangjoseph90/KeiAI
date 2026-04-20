import {
    isPermissionGranted,
    requestPermission,
    sendNotification
} from '@tauri-apps/plugin-notification';
import type { INotificationAdapter } from './types';

/**
 * Tauri Notification Adapter
 *
 * Uses `@tauri-apps/plugin-notification` to send OS-native notifications.
 */
export class TauriNotificationAdapter implements INotificationAdapter {
    async show(title: string, body?: string, icon?: string): Promise<void> {
        const granted = await this.requestPermission();
        if (!granted) return;

        sendNotification({
            title,
            body,
            icon
        });
    }

    async requestPermission(): Promise<boolean> {
        let granted = await isPermissionGranted();
        if (!granted) {
            const permission = await requestPermission();
            granted = permission === 'granted';
        }
        return granted;
    }
}
