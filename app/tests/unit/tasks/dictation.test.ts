import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import {
    cancelDictation,
    dismissDictation,
    finishDictation,
    runDictation
} from '$lib/tasks/dictation';
import { dictationTasks, recordAudioTasks } from '$lib/stores/state';

const mocks = vi.hoisted(() => ({
    start: vi.fn(),
    transcribe: vi.fn(),
    getChat: vi.fn(),
    appendDraft: vi.fn(),
    generateId: vi.fn()
}));

vi.mock('$lib/adapters/recording', () => ({
    appAudioRecorder: { start: mocks.start }
}));

vi.mock('$lib/managers/media', () => ({
    transcribeSpeech: mocks.transcribe
}));

vi.mock('$lib/stores', () => ({
    getChat: mocks.getChat,
    appendChatDraftText: mocks.appendDraft
}));

vi.mock('$lib/utils/id', () => ({
    generateId: mocks.generateId
}));

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

beforeEach(() => {
    dictationTasks.set(new Map());
    recordAudioTasks.set(new Map());
    mocks.generateId.mockReturnValue('dictation-1');
    mocks.getChat.mockResolvedValue({ id: 'chat-1', roomId: 'room-1', title: 'Chat 1' });
    mocks.appendDraft.mockResolvedValue(undefined);
});

afterEach(() => {
    for (const chatId of get(dictationTasks).keys()) cancelDictation(chatId);
    dictationTasks.set(new Map());
    recordAudioTasks.set(new Map());
});

describe('dictation task', () => {
    it('finishes recording, transcribes, and appends to the target chat draft', async () => {
        const finishResult = {
            data: new Uint8Array([1, 2, 3]),
            mimeType: 'audio/webm'
        };
        const recording = {
            failure: new Promise<never>(() => undefined),
            finish: vi.fn().mockResolvedValue(finishResult),
            cancel: vi.fn()
        };
        mocks.start.mockResolvedValue(recording);
        mocks.transcribe.mockResolvedValue({ text: 'spoken text' });

        const running = runDictation('chat-1');
        await vi.waitFor(() => expect(mocks.start).toHaveBeenCalledOnce());
        finishDictation('chat-1');
        await running;

        expect(recording.finish).toHaveBeenCalledOnce();
        expect(mocks.transcribe).toHaveBeenCalledWith(finishResult, expect.any(AbortSignal));
        expect(mocks.appendDraft).toHaveBeenCalledWith('chat-1', 'spoken text');
        expect(get(dictationTasks).get('chat-1')).toMatchObject({ status: 'completed' });
        expect(recording.cancel).toHaveBeenCalledOnce();
    });

    it('prevents another recording anywhere in the app', async () => {
        const started = deferred<never>();
        mocks.start.mockReturnValue(started.promise);

        const first = runDictation('chat-1');
        await vi.waitFor(() => expect(get(dictationTasks).get('chat-1')?.phase).toBe('recording'));
        mocks.getChat.mockResolvedValue({ id: 'chat-2' });

        await expect(runDictation('chat-2')).rejects.toMatchObject({
            code: 'INVALID_INPUT'
        });

        cancelDictation('chat-1');
        started.reject(new DOMException('Aborted', 'AbortError'));
        await first;
    });

    it('prevents dictation while an audio attachment is recording', async () => {
        recordAudioTasks.set(
            new Map([
                [
                    'chat-2',
                    {
                        id: 'record-audio-1',
                        roomId: 'room-1',
                        chatId: 'chat-2',
                        chatTitle: 'Chat 2',
                        title: 'Record audio',
                        status: 'generating',
                        phase: 'recording',
                        levels: [],
                        startedAt: 1
                    }
                ]
            ])
        );

        await expect(runDictation('chat-1')).rejects.toMatchObject({ code: 'INVALID_INPUT' });

        expect(mocks.getChat).not.toHaveBeenCalled();
        expect(mocks.start).not.toHaveBeenCalled();
    });

    it('cancels without transcribing or changing the draft', async () => {
        const recording = {
            failure: new Promise<never>(() => undefined),
            finish: vi.fn(),
            cancel: vi.fn()
        };
        mocks.start.mockResolvedValue(recording);

        const running = runDictation('chat-1');
        await vi.waitFor(() => expect(mocks.start).toHaveBeenCalledOnce());
        cancelDictation('chat-1');
        await running;

        expect(recording.finish).not.toHaveBeenCalled();
        expect(mocks.transcribe).not.toHaveBeenCalled();
        expect(mocks.appendDraft).not.toHaveBeenCalled();
        expect(get(dictationTasks).has('chat-1')).toBe(false);
    });

    it('retains a failed task until it is dismissed', async () => {
        const recording = {
            failure: new Promise<never>(() => undefined),
            finish: vi.fn().mockResolvedValue({
                data: new Uint8Array([1]),
                mimeType: 'audio/webm'
            }),
            cancel: vi.fn()
        };
        mocks.start.mockResolvedValue(recording);
        mocks.transcribe.mockRejectedValue(new Error('provider unavailable'));

        const running = runDictation('chat-1');
        await vi.waitFor(() => expect(mocks.start).toHaveBeenCalledOnce());
        finishDictation('chat-1');
        await running;

        expect(get(dictationTasks).get('chat-1')).toMatchObject({
            phase: 'error',
            errorMessage: 'provider unavailable'
        });
        expect(get(dictationTasks).get('chat-1')).toMatchObject({ status: 'error' });
        expect(mocks.appendDraft).not.toHaveBeenCalled();

        dismissDictation('chat-1');
        expect(get(dictationTasks).has('chat-1')).toBe(false);
    });
});
