import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebNotificationAdapter } from '$lib/adapters/notification/web';
import { TauriNotificationAdapter } from '$lib/adapters/notification/tauri';
import {
    isPermissionGranted,
    requestPermission,
    sendNotification
} from '@tauri-apps/plugin-notification';

vi.mock('@tauri-apps/plugin-notification', () => ({
    isPermissionGranted: vi.fn(),
    requestPermission: vi.fn(),
    sendNotification: vi.fn()
}));

describe('Notification Adapters', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('WebNotificationAdapter', () => {
        let adapter: WebNotificationAdapter;
        let originalNotification: unknown;

        beforeEach(() => {
            adapter = new WebNotificationAdapter();

            // Mock global Notification
            const mockNotificationImpl = vi.fn() as unknown as typeof Notification & {
                requestPermission: ReturnType<typeof vi.fn>;
            };
            Object.defineProperty(mockNotificationImpl, 'permission', {
                value: 'default',
                writable: true
            });
            mockNotificationImpl.requestPermission = vi.fn().mockResolvedValue('granted');

            originalNotification = global.Notification;
            global.Notification = mockNotificationImpl as unknown as typeof Notification;
        });

        afterEach(() => {
            global.Notification = originalNotification as typeof Notification;
        });

        it('requestPermission should call Notification.requestPermission when default', async () => {
            const result = await adapter.requestPermission();
            expect(global.Notification.requestPermission).toHaveBeenCalled();
            expect(result).toBe(true);
        });

        it('requestPermission should return true immediately if granted', async () => {
            Object.defineProperty(global.Notification, 'permission', { value: 'granted' });
            const result = await adapter.requestPermission();
            expect(global.Notification.requestPermission).not.toHaveBeenCalled();
            expect(result).toBe(true);
        });

        it('show should request permission and trigger notification', async () => {
            await adapter.show('Test Title', 'Test Body', 'icon.png');

            expect(global.Notification.requestPermission).toHaveBeenCalled();
            expect(global.Notification).toHaveBeenCalledWith('Test Title', {
                body: 'Test Body',
                icon: 'icon.png'
            });
        });
    });

    describe('TauriNotificationAdapter', () => {
        let adapter: TauriNotificationAdapter;

        beforeEach(() => {
            adapter = new TauriNotificationAdapter();
        });

        it('requestPermission should return true if already granted', async () => {
            vi.mocked(isPermissionGranted).mockResolvedValue(true);
            const result = await adapter.requestPermission();

            expect(isPermissionGranted).toHaveBeenCalled();
            expect(requestPermission).not.toHaveBeenCalled();
            expect(result).toBe(true);
        });

        it('requestPermission should ask if not granted', async () => {
            vi.mocked(isPermissionGranted).mockResolvedValue(false);
            vi.mocked(requestPermission).mockResolvedValue('granted');

            const result = await adapter.requestPermission();
            expect(requestPermission).toHaveBeenCalled();
            expect(result).toBe(true);
        });

        it('show should check permission and send via plugin', async () => {
            vi.mocked(isPermissionGranted).mockResolvedValue(true);

            await adapter.show('Tauri Title', 'Tauri Body', 'tauri-icon.png');
            expect(sendNotification).toHaveBeenCalledWith({
                title: 'Tauri Title',
                body: 'Tauri Body',
                icon: 'tauri-icon.png'
            });
        });

        it('show should not send via plugin if permission denied', async () => {
            vi.mocked(isPermissionGranted).mockResolvedValue(false);
            vi.mocked(requestPermission).mockResolvedValue('denied');

            await adapter.show('Tauri Title');
            expect(sendNotification).not.toHaveBeenCalled();
        });
    });
});
