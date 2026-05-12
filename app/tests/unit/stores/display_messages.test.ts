import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import {
    activeChatId,
    chatTasks,
    displayMessages,
    messageIndexes,
    messages,
    roomChats
} from '$lib/stores/state';
import type { Chat, Message } from '$lib/services';

function makeMessage(id: string, role: Message['role']): Message {
    return {
        id,
        chatId: 'chat-1',
        role,
        sortOrder: id,
        activeSwipeId: 'swipe-1',
        swipes: {
            'swipe-1': {
                id: 'swipe-1',
                content: 'Hello',
                createdAt: 1,
                speakerId: role === 'user' ? 'persona-1' : 'char-1',
                speakerName: role === 'user' ? 'Persona' : 'Character'
            }
        }
    };
}

describe('displayMessages UI model', () => {
    beforeEach(() => {
        activeChatId.set(null);
        roomChats.clear();
        messages.clear();
        chatTasks.set(new Map());
        messageIndexes.set(new Map());
    });

    it('marks stored messages as completed and preserves speaker metadata', () => {
        roomChats.set('chat-1', { id: 'chat-1', roomId: 'room-1' } as Chat);
        activeChatId.set('chat-1');
        messages.setAll([makeMessage('msg-1', 'user'), makeMessage('msg-2', 'assistant')]);
        messageIndexes.set(
            new Map([
                ['msg-1', 0],
                ['msg-2', 1]
            ])
        );

        expect(get(displayMessages)).toEqual([
            expect.objectContaining({
                id: 'msg-1',
                displayStatus: 'completed',
                messageIndex: 0,
                swipes: {
                    'swipe-1': expect.objectContaining({
                        speakerId: 'persona-1',
                        speakerName: 'Persona'
                    })
                }
            }),
            expect.objectContaining({
                id: 'msg-2',
                displayStatus: 'completed',
                messageIndex: 1,
                swipes: {
                    'swipe-1': expect.objectContaining({
                        speakerId: 'char-1',
                        speakerName: 'Character'
                    })
                }
            })
        ]);
    });

    it('overlays active chat task state onto the target message only', () => {
        roomChats.set('chat-1', { id: 'chat-1', roomId: 'room-1' } as Chat);
        activeChatId.set('chat-1');
        messages.setAll([makeMessage('msg-1', 'user'), makeMessage('msg-2', 'assistant')]);
        chatTasks.set(
            new Map([
                [
                    'chat-1',
                    {
                        status: 'error',
                        messageId: 'msg-2',
                        errorMessage: 'No character selected',
                        controller: new AbortController()
                    }
                ]
            ])
        );

        const rendered = get(displayMessages);

        expect(rendered[0]).toMatchObject({ id: 'msg-1', displayStatus: 'completed' });
        expect(rendered[1]).toMatchObject({
            id: 'msg-2',
            displayStatus: 'error',
            errorMessage: 'No character selected'
        });
    });

    it('does not leak a task from another active chat', () => {
        roomChats.set('chat-2', { id: 'chat-2', roomId: 'room-1' } as Chat);
        activeChatId.set('chat-2');
        messages.setAll([makeMessage('msg-1', 'user')]);
        chatTasks.set(
            new Map([
                [
                    'chat-1',
                    {
                        status: 'generating',
                        messageId: 'msg-1',
                        controller: new AbortController()
                    }
                ]
            ])
        );

        expect(get(displayMessages)[0]).toMatchObject({
            id: 'msg-1',
            displayStatus: 'completed'
        });
    });
});
