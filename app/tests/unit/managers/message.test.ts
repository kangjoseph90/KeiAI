import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prepareNextSwipe } from '$lib/managers/message';
import { getMessage, updateMessage } from '$lib/stores';
import type { Message } from '$lib/services';
import { AppError } from '$lib/types/errors';

vi.mock('$lib/stores', () => ({
    getMessage: vi.fn(),
    updateMessage: vi.fn()
}));

vi.mock('$lib/utils/id', () => ({ generateId: vi.fn(() => 'new-swipe') }));
vi.mock('$lib/utils/clock', () => ({ clock: { now: vi.fn(() => 2) } }));

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
                parts: [{ type: 'text', text: 'Old' }],
                createdAt: 1,
                variables: { old: '1' },
                speakerId: 'char-old',
                speakerName: 'Old Character'
            }
        }
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(updateMessage).mockResolvedValue(undefined);
        vi.mocked(getMessage).mockResolvedValue({
            ...baseMessage,
            activeSwipeId: 'new-swipe',
            swipes: {
                ...baseMessage.swipes,
                'new-swipe': {
                    id: 'new-swipe',
                    parts: [{ type: 'text', text: 'New' }],
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
            parts: [{ type: 'text', text: 'New' }],
            variables: { mood: 'calm' },
            speakerId: 'char-1',
            speakerName: 'Alpha'
        });

        expect(updateMessage).toHaveBeenCalledWith('msg-1', {
            swipes: {
                'new-swipe': {
                    id: 'new-swipe',
                    parts: [{ type: 'text', text: 'New' }],
                    variables: { mood: 'calm' },
                    speakerId: 'char-1',
                    speakerName: 'Alpha',
                    createdAt: 2
                }
            },
            activeSwipeId: 'new-swipe'
        });
        expect(result).toMatchObject({ swipeId: 'new-swipe' });
        expect(result.message.activeSwipeId).toBe('new-swipe');
    });

    it('replaces the active swipe in the same update when requested', async () => {
        await prepareNextSwipe(baseMessage, {
            parts: [{ type: 'text', text: 'Replacement' }],
            variables: {},
            replaceActiveSwipe: true
        });

        expect(updateMessage).toHaveBeenCalledWith(
            'msg-1',
            expect.objectContaining({
                swipes: expect.objectContaining({
                    'old-swipe': undefined,
                    'new-swipe': expect.objectContaining({
                        parts: [{ type: 'text', text: 'Replacement' }]
                    })
                }),
                activeSwipeId: 'new-swipe'
            })
        );
    });

    it('persists inlay parts on the new swipe', async () => {
        await prepareNextSwipe(baseMessage, {
            parts: [
                { type: 'text', text: 'With image' },
                { type: 'inlay', ids: ['inlay-1', 'inlay-2'] }
            ],
            variables: {}
        });

        expect(updateMessage).toHaveBeenCalledWith(
            'msg-1',
            expect.objectContaining({
                swipes: {
                    'new-swipe': expect.objectContaining({
                        parts: [
                            { type: 'text', text: 'With image' },
                            { type: 'inlay', ids: ['inlay-1', 'inlay-2'] }
                        ]
                    })
                }
            })
        );
    });

    it('does not delete when replaceActiveSwipe is set but the active swipe is missing', async () => {
        await prepareNextSwipe(
            {
                ...baseMessage,
                activeSwipeId: 'missing'
            },
            {
                parts: [{ type: 'text', text: 'New' }],
                variables: {},
                replaceActiveSwipe: true
            }
        );

        expect(updateMessage).toHaveBeenCalledWith(
            'msg-1',
            expect.objectContaining({
                swipes: expect.not.objectContaining({ missing: expect.anything() })
            })
        );
    });

    it('throws when the message cannot be reloaded after activating the swipe', async () => {
        vi.mocked(getMessage).mockResolvedValue(null);

        await expect(
            prepareNextSwipe(baseMessage, {
                parts: [{ type: 'text', text: 'New' }],
                variables: {}
            })
        ).rejects.toThrow(AppError);
    });
});
