import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    notifyTranslationTaskComplete,
    notifyTranslationTaskError
} from '$lib/stores/tasks/translation';
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

describe('translation task system notifications', () => {
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
        notifyTranslationTaskComplete('message-1');
        notifyTranslationTaskError('message-1', 'provider failed');
        await Promise.resolve();

        expect(NotificationService.show).not.toHaveBeenCalled();
    });

    it('uses OS notifications while the app is in the background', async () => {
        setVisibleState(false);

        notifyTranslationTaskComplete('message-1');
        notifyTranslationTaskError('message-1', 'provider failed');

        await vi.waitFor(() => expect(NotificationService.show).toHaveBeenCalledTimes(2));
        expect(NotificationService.show).toHaveBeenNthCalledWith(1, {
            title: 'Translation ready',
            body: 'A translation has finished generating.'
        });
        expect(NotificationService.show).toHaveBeenNthCalledWith(2, {
            title: 'Translation failed',
            body: 'provider failed'
        });
    });
});
