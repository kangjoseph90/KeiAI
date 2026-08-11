import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import {
    chatTasks,
    commandTasks,
    collectedTasks,
    dictationTasks,
    imageGenerationTasks,
    inputTranslationTasks,
    suggestionTasks,
    titleTasks,
    translationTasks,
    ttsTasks,
    recordAudioTasks
} from '$lib/stores/state';
import { consumeCompletedTasks, getChatTaskIndicator } from '$lib/stores/tasks/activity';

const metadata = {
    roomId: 'room-1',
    chatId: 'chat-1',
    chatTitle: 'Chat 1',
    title: 'Task',
    startedAt: 1
};

beforeEach(() => {
    vi.useFakeTimers();
    chatTasks.set(new Map());
    commandTasks.set(new Map());
    dictationTasks.set(new Map());
    recordAudioTasks.set(new Map());
    imageGenerationTasks.set(new Map());
    inputTranslationTasks.set(new Map());
    suggestionTasks.set(new Map());
    titleTasks.set(new Map());
    translationTasks.set(new Map());
    ttsTasks.set(new Map());
});

afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
});

describe('task collector', () => {
    it('collects existing task maps without a mirrored registry', () => {
        chatTasks.set(
            new Map([['chat-1', { ...metadata, status: 'generating', messageId: 'message-1' }]])
        );
        dictationTasks.set(
            new Map([
                [
                    'chat-2',
                    {
                        ...metadata,
                        chatId: 'chat-2',
                        id: 'session-1',
                        status: 'generating',
                        phase: 'transcribing',
                        levels: []
                    }
                ]
            ])
        );
        recordAudioTasks.set(
            new Map([
                [
                    'chat-3',
                    {
                        ...metadata,
                        chatId: 'chat-3',
                        id: 'record-audio-1',
                        status: 'generating',
                        phase: 'recording',
                        levels: []
                    }
                ]
            ])
        );

        expect(get(collectedTasks)).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: 'chat:chat-1', status: 'running' }),
                expect.objectContaining({
                    id: 'dictation:chat-2',
                    status: 'running',
                    phase: 'transcribing'
                }),
                expect.objectContaining({
                    id: 'record_audio:chat-3',
                    status: 'running',
                    phase: 'recording'
                })
            ])
        );
    });

    it('consumes only completed records for the entered chat', () => {
        chatTasks.set(
            new Map([['chat-1', { ...metadata, status: 'generating', messageId: 'message-1' }]])
        );
        translationTasks.set(
            new Map([
                [
                    'message-2',
                    {
                        ...metadata,
                        status: 'error',
                        sourceHash: 'hash',
                        errorMessage: 'failed'
                    }
                ]
            ])
        );
        dictationTasks.set(
            new Map([
                [
                    'chat-1',
                    {
                        ...metadata,
                        id: 'session-1',
                        status: 'completed',
                        phase: 'transcribing',
                        levels: []
                    }
                ],
                [
                    'chat-2',
                    {
                        ...metadata,
                        chatId: 'chat-2',
                        id: 'session-2',
                        status: 'completed',
                        phase: 'transcribing',
                        levels: []
                    }
                ]
            ])
        );
        recordAudioTasks.set(
            new Map([
                [
                    'chat-1',
                    {
                        ...metadata,
                        id: 'record-audio-1',
                        status: 'completed',
                        phase: 'saving',
                        levels: []
                    }
                ]
            ])
        );

        consumeCompletedTasks('chat-1');

        expect(get(dictationTasks).has('chat-1')).toBe(true);
        vi.runOnlyPendingTimers();

        expect(get(dictationTasks).has('chat-1')).toBe(false);
        expect(get(dictationTasks).has('chat-2')).toBe(true);
        expect(get(recordAudioTasks).has('chat-1')).toBe(false);
        expect(get(chatTasks).has('chat-1')).toBe(true);
        expect(get(translationTasks).has('message-2')).toBe(true);
    });

    it('delays completed command consumption through the common path', () => {
        commandTasks.set(
            new Map([
                [
                    'chat-1',
                    {
                        ...metadata,
                        status: 'completed',
                        commandId: 'command-1',
                        commandName: 'compact'
                    }
                ]
            ])
        );

        expect(get(collectedTasks)).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ kind: 'command', status: 'completed' })
            ])
        );

        consumeCompletedTasks('chat-1');
        consumeCompletedTasks('chat-1');
        expect(get(commandTasks).has('chat-1')).toBe(true);
        vi.runOnlyPendingTimers();
        expect(get(commandTasks).has('chat-1')).toBe(false);
    });

    it('derives chat indicator precedence as error, running, then completed', () => {
        const task = (status: 'running' | 'completed' | 'error') => ({
            id: `chat:${status}`,
            kind: 'chat' as const,
            taskKey: status,
            ...metadata,
            status
        });

        expect(getChatTaskIndicator([task('completed')], 'chat-1')).toBe('completed');
        expect(getChatTaskIndicator([task('completed'), task('running')], 'chat-1')).toBe(
            'running'
        );
        expect(
            getChatTaskIndicator([task('completed'), task('running'), task('error')], 'chat-1')
        ).toBe('error');
        expect(getChatTaskIndicator([], 'chat-1')).toBeNull();
    });
});
