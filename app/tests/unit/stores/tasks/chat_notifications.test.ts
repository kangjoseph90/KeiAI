import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activeChatId } from '$lib/stores/state';
import { notifyChatTaskComplete, notifyChatTaskError } from '$lib/stores/tasks/chat';
import { NotificationService } from '$lib/services/notification';
import { toast } from '$lib/ui/toast';

vi.mock('$lib/services/notification', () => ({
    NotificationService: {
        show: vi.fn()
    }
}));

vi.mock('$lib/ui/toast', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn()
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

describe('chat task notifications', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        activeChatId.set(null);
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

    it('stays quiet when the completed chat is visible and active', async () => {
        activeChatId.set('chat-1');

        notifyChatTaskComplete('chat-1');
        await Promise.resolve();

        expect(NotificationService.show).not.toHaveBeenCalled();
        expect(toast.success).not.toHaveBeenCalled();
    });

    it('shows a toast when another chat completes while the app is visible', async () => {
        activeChatId.set('chat-2');

        notifyChatTaskComplete('chat-1');
        await Promise.resolve();

        expect(NotificationService.show).not.toHaveBeenCalled();
        expect(toast.success).toHaveBeenCalledWith({
            title: 'Response ready',
            description: 'A chat response has finished generating.'
        });
    });

    it('uses OS notification for background completion', async () => {
        setVisibleState(false);

        notifyChatTaskComplete('chat-1');

        await vi.waitFor(() => {
            expect(NotificationService.show).toHaveBeenCalledWith({
                title: 'Response ready',
                body: 'A chat response has finished generating.'
            });
        });
        expect(toast.success).not.toHaveBeenCalled();
    });

    it('falls back to toast when background notification cannot be shown', async () => {
        setVisibleState(false);
        vi.mocked(NotificationService.show).mockResolvedValue(false);

        notifyChatTaskComplete('chat-1');

        await vi.waitFor(() => {
            expect(toast.success).toHaveBeenCalledWith({
                title: 'Response ready',
                description: 'A chat response has finished generating.',
                persistent: true
            });
        });
    });

    it('shows foreground task errors as toast', async () => {
        notifyChatTaskError('chat-1', 'Network failed');
        await Promise.resolve();

        expect(NotificationService.show).not.toHaveBeenCalled();
        expect(toast.error).toHaveBeenCalledWith({
            title: 'Chat task failed',
            description: 'Network failed'
        });
    });

    it('uses OS notification for background task errors', async () => {
        setVisibleState(false);

        notifyChatTaskError('chat-1', 'Network failed');

        await vi.waitFor(() => {
            expect(NotificationService.show).toHaveBeenCalledWith({
                title: 'Chat task failed',
                body: 'Network failed'
            });
        });
        expect(toast.error).not.toHaveBeenCalled();
    });
});
