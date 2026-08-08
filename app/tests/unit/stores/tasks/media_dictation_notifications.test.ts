import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    notifyImageGenerationTaskComplete,
    notifyImageGenerationTaskError
} from '$lib/stores/tasks/image';
import { notifyTTSTaskComplete, notifyTTSTaskError } from '$lib/stores/tasks/tts';
import { notifyDictationTaskComplete, notifyDictationTaskError } from '$lib/stores/tasks/dictation';
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

describe('media and dictation task system notifications', () => {
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
        notifyImageGenerationTaskComplete('message-1');
        notifyTTSTaskComplete('message-1');
        notifyDictationTaskComplete('chat-1');
        await Promise.resolve();

        expect(NotificationService.show).not.toHaveBeenCalled();
    });

    it('notifies image completion and failure in the background', async () => {
        setVisibleState(false);

        notifyImageGenerationTaskComplete('message-1');
        notifyImageGenerationTaskError('message-1', 'provider failed');

        await vi.waitFor(() => expect(NotificationService.show).toHaveBeenCalledTimes(2));
        expect(NotificationService.show).toHaveBeenNthCalledWith(1, {
            title: 'Image ready',
            body: 'An image has finished generating.'
        });
        expect(NotificationService.show).toHaveBeenNthCalledWith(2, {
            title: 'Image generation failed',
            body: 'provider failed'
        });
    });

    it('notifies speech completion and failure in the background', async () => {
        setVisibleState(false);

        notifyTTSTaskComplete('message-1');
        notifyTTSTaskError('message-1', 'provider failed');

        await vi.waitFor(() => expect(NotificationService.show).toHaveBeenCalledTimes(2));
        expect(NotificationService.show).toHaveBeenNthCalledWith(1, {
            title: 'Speech ready',
            body: 'Speech audio has finished generating.'
        });
        expect(NotificationService.show).toHaveBeenNthCalledWith(2, {
            title: 'Speech generation failed',
            body: 'provider failed'
        });
    });

    it('notifies dictation completion and failure in the background', async () => {
        setVisibleState(false);

        notifyDictationTaskComplete('chat-1');
        notifyDictationTaskError('chat-1', 'provider failed');

        await vi.waitFor(() => expect(NotificationService.show).toHaveBeenCalledTimes(2));
        expect(NotificationService.show).toHaveBeenNthCalledWith(1, {
            title: 'Dictation ready',
            body: 'Your transcript was added to the chat draft.'
        });
        expect(NotificationService.show).toHaveBeenNthCalledWith(2, {
            title: 'Dictation failed',
            body: 'provider failed'
        });
    });
});
