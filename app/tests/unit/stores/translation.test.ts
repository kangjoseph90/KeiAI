import { afterEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { translationTasks } from '$lib/stores/state';
import {
    clearTranslationTask,
    createTranslationTask,
    setTranslationTaskError
} from '$lib/stores/tasks/translation';

describe('translation task store', () => {
    afterEach(() => {
        translationTasks.set(new Map());
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
