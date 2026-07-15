import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationService } from '$lib/services/notification';
import { appNotification } from '$lib/adapters/notification';

vi.mock('$lib/adapters/notification', () => ({
    appNotification: {
        requestPermission: vi.fn(),
        show: vi.fn()
    }
}));

describe('NotificationService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('shows an OS notification when permission is granted', async () => {
        vi.mocked(appNotification.requestPermission).mockResolvedValue(true);

        const shown = await NotificationService.show({
            title: 'Task complete',
            body: 'A task finished.'
        });

        expect(shown).toBe(true);
        expect(appNotification.show).toHaveBeenCalledWith(
            'Task complete',
            'A task finished.',
            undefined
        );
    });

    it('reports false when permission is denied', async () => {
        vi.mocked(appNotification.requestPermission).mockResolvedValue(false);

        const shown = await NotificationService.show({ title: 'Task complete' });

        expect(shown).toBe(false);
        expect(appNotification.show).not.toHaveBeenCalled();
    });

    it('reports false when the adapter throws', async () => {
        vi.mocked(appNotification.requestPermission).mockRejectedValue(new Error('blocked'));

        const shown = await NotificationService.show({ title: 'Task complete' });

        expect(shown).toBe(false);
    });
});
