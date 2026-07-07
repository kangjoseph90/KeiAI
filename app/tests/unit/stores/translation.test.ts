import { afterEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { translationTasks, translations, translationsByMessage } from '$lib/stores/state';
import {
    clearTranslationTask,
    createTranslationTask,
    setTranslationTaskError
} from '$lib/stores/tasks/translation';

describe('translation store indexes', () => {
    afterEach(() => {
        translations.clear();
        translationTasks.set(new Map());
    });

    it('groups every loaded translation by message id', () => {
        translations.setAll([
            {
                id: 'translation-1',
                chatId: 'chat-1',
                messageId: 'message-1',
                sourceHash: 'hash-1',
                text: '첫 번째'
            },
            {
                id: 'translation-2',
                chatId: 'chat-1',
                messageId: 'message-1',
                sourceHash: 'hash-2',
                text: '두 번째'
            },
            {
                id: 'translation-3',
                chatId: 'chat-1',
                messageId: 'message-2',
                sourceHash: 'hash-3',
                text: '다른 메시지'
            }
        ]);

        const byMessage = get(translationsByMessage);
        expect(byMessage.get('message-1')?.map((translation) => translation.id)).toEqual([
            'translation-1',
            'translation-2'
        ]);
        expect(byMessage.get('message-2')?.[0]?.id).toBe('translation-3');
    });

    it('tracks execution state and errors per message', () => {
        const controller = new AbortController();

        createTranslationTask('message-1', 'hash-1', controller);
        setTranslationTaskError('message-1', 'failed');

        expect(get(translationTasks).get('message-1')).toEqual({
            status: 'error',
            errorMessage: 'failed',
            sourceHash: 'hash-1',
            controller
        });

        clearTranslationTask('message-1');
        expect(get(translationTasks).has('message-1')).toBe(false);
    });
});
