import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyChatTaskComplete, notifyChatTaskError } from '$lib/stores/tasks/chat';
import { NotificationService } from '$lib/services/notification';

vi.mock('$lib/services/notification', () => ({
    NotificationService: {
        show: vi.fn()
    }
}));

const originalVisibilityState = document.visibilityState;

function setVisibleState(visible: boolean): void {
    Object.defineProperty(document, 'visibilityState', {
        value: visible ? 'visible' : 'hidden',
        configurable: true
    });
    vi.spyOn(document, 'hasFocus').mockReturnValue(visible);
}

describe('chat task system notifications', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setVisibleState(true);
        vi.mocked(NotificationService.show).mockResolvedValue(true);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        Object.defineProperty(document, 'visibilityState', {
            value: originalVisibilityState,
            configurable: true
        });
    });

    it('stays quiet while the app is focused', async () => {
        notifyChatTaskComplete('chat-1');
        notifyChatTaskError('chat-1', 'Network failed');
        await Promise.resolve();

        expect(NotificationService.show).not.toHaveBeenCalled();
    });

    it('uses OS notifications while the app is in the background', async () => {
        setVisibleState(false);

        notifyChatTaskComplete('chat-1');
        notifyChatTaskError('chat-1', 'Network failed');

        await vi.waitFor(() => expect(NotificationService.show).toHaveBeenCalledTimes(2));
        expect(NotificationService.show).toHaveBeenNthCalledWith(1, {
            title: 'Response ready',
            body: 'A chat response has finished generating.'
        });
        expect(NotificationService.show).toHaveBeenNthCalledWith(2, {
            title: 'Chat task failed',
            body: 'Network failed'
        });
    });

    it('does not create an in-app fallback when OS notification is unavailable', async () => {
        setVisibleState(false);
        vi.mocked(NotificationService.show).mockResolvedValue(false);

        notifyChatTaskComplete('chat-1');

        await vi.waitFor(() => expect(NotificationService.show).toHaveBeenCalledOnce());
    });
});
