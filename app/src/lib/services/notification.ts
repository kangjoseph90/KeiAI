import { appNotification } from '$lib/adapters/notification';
import { createLogger } from '$lib/adapters/logger';

export interface NotificationRequest {
    title: string;
    body?: string;
    icon?: string;
}

const logger = createLogger('service:notification');

export class NotificationService {
    static async show(request: NotificationRequest): Promise<boolean> {
        try {
            const granted = await appNotification.requestPermission();
            if (!granted) return false;

            await appNotification.show(request.title, request.body, request.icon);
            return true;
        } catch (error) {
            logger.warn('Failed to show notification', error);
            return false;
        }
    }
}
