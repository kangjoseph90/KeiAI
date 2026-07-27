import { afterEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { imageGenerationTasks, ttsTasks } from '$lib/stores/state';
import {
    clearImageGenerationTask,
    createImageGenerationTask,
    setImageGenerationTaskError
} from '$lib/stores/tasks/image';
import { clearTTSTask, createTTSTask, setTTSTaskError } from '$lib/stores/tasks/tts';

describe('media task stores', () => {
    afterEach(() => {
        imageGenerationTasks.set(new Map());
        ttsTasks.set(new Map());
    });

    it('tracks image and TTS tasks independently for the same message', () => {
        const imageController = new AbortController();
        const ttsController = new AbortController();

        createImageGenerationTask('message-1', imageController);
        createTTSTask('message-1', ttsController);
        setImageGenerationTaskError('message-1', 'image failed');
        setTTSTaskError('message-1', 'audio failed');

        expect(get(imageGenerationTasks).get('message-1')).toEqual({
            status: 'error',
            errorMessage: 'image failed',
            controller: imageController
        });
        expect(get(ttsTasks).get('message-1')).toEqual({
            status: 'error',
            errorMessage: 'audio failed',
            controller: ttsController
        });

        clearImageGenerationTask('message-1');
        expect(get(imageGenerationTasks).has('message-1')).toBe(false);
        expect(get(ttsTasks).has('message-1')).toBe(true);

        clearTTSTask('message-1');
        expect(get(ttsTasks).has('message-1')).toBe(false);
    });
});
