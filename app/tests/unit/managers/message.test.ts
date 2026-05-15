import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prepareNextSwipe } from '$lib/managers/message';
import { createMessageSwipe, deleteMessageSwipe, getMessage, updateMessage } from '$lib/stores';
import type { Message } from '$lib/services';
import { AppError } from '$lib/types/errors';

vi.mock('$lib/stores', () => ({
    createMessageSwipe: vi.fn(),
    deleteMessageSwipe: vi.fn(),
    getMessage: vi.fn(),
    updateMessage: vi.fn()
}));

describe('MessageManager', () => {
    const baseMessage: Message = {
        id: 'msg-1',
        chatId: 'chat-1',
        scopeType: 'user',
        scopeId: 'user-1',
        role: 'assistant',
        sortOrder: 'a',
        activeSwipeId: 'old-swipe',
        swipes: {
            'old-swipe': {
                id: 'old-swipe',
                content: 'Old',
                createdAt: 1,
                variables: { old: '1' },
                speakerId: 'char-old',
                speakerName: 'Old Character'
            }
        }
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(createMessageSwipe).mockResolvedValue({
            swipeId: 'new-swipe',
            message: {
                ...baseMessage,
                swipes: {
                    ...baseMessage.swipes,
                    'new-swipe': {
                        id: 'new-swipe',
                        content: 'New',
                        createdAt: 2,
                        variables: { mood: 'calm' },
                        speakerId: 'char-1',
                        speakerName: 'Alpha'
                    }
                }
            }
        });
        vi.mocked(updateMessage).mockResolvedValue(undefined);
        vi.mocked(getMessage).mockResolvedValue({
            ...baseMessage,
            activeSwipeId: 'new-swipe',
            swipes: {
                ...baseMessage.swipes,
                'new-swipe': {
                    id: 'new-swipe',
                    content: 'New',
                    createdAt: 2,
                    variables: { mood: 'calm' },
                    speakerId: 'char-1',
                    speakerName: 'Alpha'
                }
            }
        });
    });

    it('creates a new active swipe with variables and speaker metadata', async () => {
        const result = await prepareNextSwipe(baseMessage, {
            content: 'New',
            variables: { mood: 'calm' },
            speakerId: 'char-1',
            speakerName: 'Alpha'
        });

        expect(deleteMessageSwipe).not.toHaveBeenCalled();
        expect(createMessageSwipe).toHaveBeenCalledWith('msg-1', {
            content: 'New',
            variables: { mood: 'calm' },
            speakerId: 'char-1',
            speakerName: 'Alpha'
        });
        expect(updateMessage).toHaveBeenCalledWith('msg-1', { activeSwipeId: 'new-swipe' });
        expect(result).toMatchObject({ swipeId: 'new-swipe' });
        expect(result.message.activeSwipeId).toBe('new-swipe');
    });

    it('deletes the active swipe first when replaceActiveSwipe is enabled', async () => {
        const withoutOldSwipe: Message = {
            ...baseMessage,
            activeSwipeId: '',
            swipes: {}
        };
        vi.mocked(deleteMessageSwipe).mockResolvedValue(withoutOldSwipe);

        await prepareNextSwipe(baseMessage, {
            content: 'Replacement',
            variables: {},
            replaceActiveSwipe: true
        });

        expect(deleteMessageSwipe).toHaveBeenCalledWith('msg-1', 'old-swipe');
        expect(createMessageSwipe).toHaveBeenCalledWith('msg-1', {
            content: 'Replacement',
            variables: {},
            speakerId: undefined,
            speakerName: undefined
        });
    });

    it('does not delete when replaceActiveSwipe is set but the active swipe is missing', async () => {
        await prepareNextSwipe(
            {
                ...baseMessage,
                activeSwipeId: 'missing'
            },
            {
                content: 'New',
                variables: {},
                replaceActiveSwipe: true
            }
        );

        expect(deleteMessageSwipe).not.toHaveBeenCalled();
        expect(createMessageSwipe).toHaveBeenCalled();
    });

    it('throws when the message cannot be reloaded after activating the swipe', async () => {
        vi.mocked(getMessage).mockResolvedValue(null);

        await expect(
            prepareNextSwipe(baseMessage, {
                content: 'New',
                variables: {}
            })
        ).rejects.toThrow(AppError);
    });
});
