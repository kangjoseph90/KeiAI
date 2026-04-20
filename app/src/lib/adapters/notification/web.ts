import type { INotificationAdapter } from './types';

/**
 * Web Notification Adapter
 *
 * Uses the Web Notifications API.
 */
export class WebNotificationAdapter implements INotificationAdapter {
    async show(title: string, body?: string, icon?: string): Promise<void> {
        if (!('Notification' in window)) return;

        let perm = Notification.permission;
        if (perm === 'default') {
            const granted = await this.requestPermission();
            if (!granted) return;
            perm = 'granted';
        }

        if (perm === 'granted') {
            new Notification(title, { body, icon });
        }
    }

    async requestPermission(): Promise<boolean> {
        if (!('Notification' in window)) return false;
        if (Notification.permission === 'granted') return true;
        if (Notification.permission === 'denied') return false;

        const result = await Notification.requestPermission();
        return result === 'granted';
    }
}

export const webNotification = new WebNotificationAdapter();
