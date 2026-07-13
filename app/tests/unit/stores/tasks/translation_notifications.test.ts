import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activeChatId } from '$lib/stores/state';
import {
    notifyTranslationTaskComplete,
    notifyTranslationTaskError
} from '$lib/stores/tasks/translation';
import { MessageService } from '$lib/services';
import { NotificationService } from '$lib/services/notification';
import { toast } from '$lib/ui/toast';

vi.mock('$lib/services', () => ({
    MessageService: {
        get: vi.fn()
    }
}));

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

describe('translation task notifications', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        activeChatId.set(null);
        setVisibleState(true);
        vi.mocked(MessageService.get).mockResolvedValue({
            id: 'message-1',
            chatId: 'chat-1'
        } as Awaited<ReturnType<typeof MessageService.get>>);
        vi.mocked(NotificationService.show).mockResolvedValue(true);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        Object.defineProperty(document, 'visibilityState', {
            value: originalVisibilityState,
            configurable: true
        });
    });

    it('stays quiet when the translated message belongs to the active visible chat', async () => {
        activeChatId.set('chat-1');

        notifyTranslationTaskComplete('message-1');

        await vi.waitFor(() => {
            expect(MessageService.get).toHaveBeenCalledWith('message-1');
        });
        expect(NotificationService.show).not.toHaveBeenCalled();
        expect(toast.success).not.toHaveBeenCalled();
    });

    it('shows a toast when another chat translation completes while the app is visible', async () => {
        activeChatId.set('chat-2');

        notifyTranslationTaskComplete('message-1');

        await vi.waitFor(() => {
            expect(toast.success).toHaveBeenCalledWith({
                title: 'Translation ready',
                description: 'A translation has finished generating.'
            });
        });
        expect(NotificationService.show).not.toHaveBeenCalled();
    });

    it('uses OS notification for background translation completion', async () => {
        setVisibleState(false);

        notifyTranslationTaskComplete('message-1');

        await vi.waitFor(() => {
            expect(NotificationService.show).toHaveBeenCalledWith({
                title: 'Translation ready',
                body: 'A translation has finished generating.'
            });
        });
        expect(toast.success).not.toHaveBeenCalled();
    });

    it('falls back to toast when background notification cannot be shown', async () => {
        setVisibleState(false);
        vi.mocked(NotificationService.show).mockResolvedValue(false);

        notifyTranslationTaskComplete('message-1');

        await vi.waitFor(() => {
            expect(toast.success).toHaveBeenCalledWith({
                title: 'Translation ready',
                description: 'A translation has finished generating.',
                persistent: true
            });
        });
    });

    it('shows foreground translation errors as toast', async () => {
        notifyTranslationTaskError('message-1', 'provider failed');
        await Promise.resolve();

        expect(NotificationService.show).not.toHaveBeenCalled();
        expect(toast.error).toHaveBeenCalledWith({
            title: 'Translation failed',
            description: 'provider failed'
        });
    });

    it('uses OS notification for background translation errors', async () => {
        setVisibleState(false);

        notifyTranslationTaskError('message-1', 'provider failed');

        await vi.waitFor(() => {
            expect(NotificationService.show).toHaveBeenCalledWith({
                title: 'Translation failed',
                body: 'provider failed'
            });
        });
        expect(toast.error).not.toHaveBeenCalled();
    });
});
