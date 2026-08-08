/**
 * Store Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
    appSettings,
    activeUser,
    pbConnected,
    isLoggedIn,
    messages,
    chatTasks,
    activeChatId,
    roomChats,
    displayMessages,
    isChatRunning
} from '$lib/stores/state';
import type { AppSettings, User, Chat, Message } from '$lib/services';
import type { ChatTask } from '$lib/stores/types';

function makeMockTask(overrides: Partial<ChatTask> = {}): ChatTask {
    return {
        roomId: 'room-1',
        chatId: 'chat-1',
        chatTitle: 'Chat 1',
        title: 'Chat response',
        startedAt: 1,
        status: 'generating',
        messageId: 'm-gen',
        controller: new AbortController(),
        ...overrides
    };
}

describe('Global Stores', () => {
    beforeEach(() => {
        // Reset stores to default state
        appSettings.set(null);
        activeUser.set(null);
        pbConnected.set(false);
        messages.clear();
        chatTasks.set(new Map());
        roomChats.clear();
        activeChatId.set(null);
    });

    describe('Authentication State (Derived)', () => {
        it('should be logged in when user is sync linked and pb is connected', () => {
            activeUser.set({
                id: 'u1',
                name: 'Local',
                avatar: '',
                username: 'kei',
                connections: { server: { mode: 'default' }, proxy: { mode: 'default' } }
            } as User);
            pbConnected.set(true);
            expect(get(isLoggedIn)).toBe(true);
        });

        it('should not be logged in if pb is disconnected', () => {
            activeUser.set({
                id: 'u1',
                name: 'Local',
                avatar: '',
                username: 'kei',
                connections: { server: { mode: 'default' }, proxy: { mode: 'default' } }
            } as User);
            pbConnected.set(false);
            expect(get(isLoggedIn)).toBe(false);
        });

        it('should not be logged in when the local user has no linked account', () => {
            activeUser.set({
                id: 'u1',
                name: 'Local',
                avatar: '',
                connections: { server: { mode: 'default' }, proxy: { mode: 'default' } }
            } as User);
            pbConnected.set(true);
            expect(get(isLoggedIn)).toBe(false);
        });
    });

    describe('Generation State (Derived)', () => {
        it('should indicate generation is running for active chat', () => {
            const chatId = 'chat-1';
            roomChats.set(chatId, { id: chatId } as Chat);
            activeChatId.set(chatId);

            chatTasks.set(new Map<string, ChatTask>([[chatId, makeMockTask()]]));

            expect(get(isChatRunning)).toBe(true);
        });

        it('should not indicate generation for different chat', () => {
            roomChats.set('chat-1', { id: 'chat-1' } as Chat);
            activeChatId.set('chat-1');

            chatTasks.set(new Map<string, ChatTask>([['chat-2', makeMockTask()]]));

            expect(get(isChatRunning)).toBe(false);
        });
    });

    describe('Display Messages (Derived)', () => {
        it('should mark generating message from DB with displayStatus', () => {
            const chatId = 'chat-1';
            roomChats.set(chatId, { id: chatId } as Chat);
            activeChatId.set(chatId);

            const dbMessages: Message[] = [
                {
                    id: 'm1',
                    chatId,
                    scopeType: 'user',
                    scopeId: 'user-1',
                    role: 'user',
                    swipes: {
                        s1: {
                            id: 's1',
                            parts: [{ type: 'text', text: 'hello' }],
                            createdAt: 1000
                        }
                    },
                    activeSwipeId: 's1',
                    sortOrder: 'a'
                } as Message,
                {
                    id: 'm-gen',
                    chatId,
                    scopeType: 'user',
                    scopeId: 'user-1',
                    role: 'assistant',
                    swipes: {
                        s1: {
                            id: 's1',
                            parts: [{ type: 'text', text: 'world' }],
                            createdAt: 1001
                        }
                    },
                    activeSwipeId: 's1',
                    sortOrder: 'b'
                } as Message
            ];
            messages.setAll(dbMessages);

            chatTasks.set(
                new Map<string, ChatTask>([[chatId, makeMockTask({ messageId: 'm-gen' })]])
            );

            const display = get(displayMessages);

            expect(display).toHaveLength(2);
            expect(display[0].id).toBe('m1');
            expect(display[0].displayStatus).toBe('completed');
            expect(display[1].id).toBe('m-gen');
            expect(display[1].displayStatus).toBe('generating');
        });

        it('should only show DB messages if no generation task', () => {
            const chatId = 'chat-1';
            roomChats.set(chatId, { id: chatId } as Chat);
            activeChatId.set(chatId);
            messages.setAll([{ id: 'm1', swipes: {}, activeSwipeId: '' } as unknown as Message]);
            chatTasks.set(new Map());

            const display = get(displayMessages);
            expect(display).toHaveLength(1);
            expect(display[0].id).toBe('m1');
            expect(display[0].displayStatus).toBe('completed');
        });

        it('should mark message with error status', () => {
            const chatId = 'chat-1';
            roomChats.set(chatId, { id: chatId } as Chat);
            activeChatId.set(chatId);

            const dbMessages: Message[] = [
                {
                    id: 'm-gen',
                    chatId,
                    scopeType: 'user',
                    scopeId: 'user-1',
                    role: 'assistant',
                    swipes: {
                        s1: { id: 's1', parts: [{ type: 'text', text: '' }], createdAt: 1000 }
                    },
                    activeSwipeId: 's1',
                    sortOrder: 'a'
                } as Message
            ];
            messages.setAll(dbMessages);

            chatTasks.set(
                new Map<string, ChatTask>([
                    [chatId, makeMockTask({ status: 'error', errorMessage: 'Network fail' })]
                ])
            );

            const display = get(displayMessages);
            expect(display[0].displayStatus).toBe('error');
            expect(display[0].errorMessage).toBe('Network fail');
        });
    });
});
