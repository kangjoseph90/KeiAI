import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import {
    cancelRecordAudio,
    dismissRecordAudio,
    finishRecordAudio,
    runRecordAudio
} from '$lib/tasks/record_audio';
import { dictationTasks, recordAudioTasks } from '$lib/stores/state';

const mocks = vi.hoisted(() => ({
    start: vi.fn(),
    getChat: vi.fn(),
    loadDraft: vi.fn(),
    getDraft: vi.fn(),
    createInlay: vi.fn(),
    deleteInlay: vi.fn(),
    addDraftInlay: vi.fn(),
    setDraftInlayIds: vi.fn(),
    generateId: vi.fn()
}));

vi.mock('$lib/adapters/recording', () => ({
    appAudioRecorder: { start: mocks.start }
}));

vi.mock('$lib/stores', () => ({
    getChat: mocks.getChat,
    loadChatDraft: mocks.loadDraft,
    getChatDraft: mocks.getDraft,
    createChatInlay: mocks.createInlay,
    deleteChatInlay: mocks.deleteInlay,
    addChatDraftInlay: mocks.addDraftInlay,
    setChatDraftInlayIds: mocks.setDraftInlayIds,
    MAX_CHAT_DRAFT_INLAYS: 4
}));

vi.mock('$lib/utils/id', () => ({
    generateId: mocks.generateId
}));

function pendingFailure(): Promise<never> {
    return new Promise<never>(() => undefined);
}

beforeEach(() => {
    vi.clearAllMocks();
    dictationTasks.set(new Map());
    recordAudioTasks.set(new Map());
    mocks.generateId.mockReturnValue('record-audio-1');
    mocks.getChat.mockResolvedValue({
        id: 'chat-1',
        roomId: 'room-1',
        title: 'Chat 1'
    });
    mocks.loadDraft.mockResolvedValue({ text: '', inlayIds: [], suggestions: {} });
    mocks.getDraft.mockReturnValue({ text: '', inlayIds: [], suggestions: {} });
    mocks.addDraftInlay.mockReturnValue(true);
    mocks.deleteInlay.mockResolvedValue(undefined);
});

afterEach(() => {
    for (const chatId of get(recordAudioTasks).keys()) cancelRecordAudio(chatId);
    dictationTasks.set(new Map());
    recordAudioTasks.set(new Map());
});

describe('record audio task', () => {
    it('finishes recording and adds the audio as a draft inlay', async () => {
        const finishResult = {
            data: new Uint8Array([1, 2, 3]),
            mimeType: 'audio/webm;codecs=opus'
        };
        const recording = {
            failure: pendingFailure(),
            finish: vi.fn().mockResolvedValue(finishResult),
            cancel: vi.fn()
        };
        mocks.start.mockResolvedValue(recording);
        mocks.createInlay.mockResolvedValue({ id: 'inlay-1' });

        const running = runRecordAudio('chat-1');
        await vi.waitFor(() =>
            expect(get(recordAudioTasks).get('chat-1')?.phase).toBe('recording')
        );
        finishRecordAudio('chat-1');
        await running;

        expect(recording.finish).toHaveBeenCalledOnce();
        expect(mocks.createInlay).toHaveBeenCalledWith('chat-1', expect.any(File));
        const file = mocks.createInlay.mock.calls[0][1] as File;
        expect(file.name).toMatch(/^Recording .+\.webm$/);
        expect(file.type).toBe('audio/webm');
        expect(new Uint8Array(await file.arrayBuffer())).toEqual(finishResult.data);
        expect(mocks.addDraftInlay).toHaveBeenCalledWith('chat-1', 'inlay-1');
        expect(get(recordAudioTasks).get('chat-1')).toMatchObject({
            status: 'completed',
            phase: 'saving'
        });
        expect(recording.cancel).toHaveBeenCalledOnce();

        dismissRecordAudio('chat-1');
        expect(get(recordAudioTasks).has('chat-1')).toBe(false);
    });

    it('prevents recording when the draft attachments are full', async () => {
        mocks.loadDraft.mockResolvedValue({
            text: '',
            inlayIds: ['1', '2', '3', '4'],
            suggestions: {}
        });

        await expect(runRecordAudio('chat-1')).rejects.toMatchObject({ code: 'INVALID_INPUT' });

        expect(mocks.start).not.toHaveBeenCalled();
        expect(get(recordAudioTasks).has('chat-1')).toBe(false);
    });

    it('prevents recording while dictation is recording', async () => {
        dictationTasks.set(
            new Map([
                [
                    'chat-2',
                    {
                        id: 'dictation-1',
                        roomId: 'room-1',
                        chatId: 'chat-2',
                        chatTitle: 'Chat 2',
                        title: 'Dictation',
                        status: 'generating',
                        phase: 'recording',
                        levels: [],
                        startedAt: 1
                    }
                ]
            ])
        );

        await expect(runRecordAudio('chat-1')).rejects.toMatchObject({ code: 'INVALID_INPUT' });

        expect(mocks.getChat).not.toHaveBeenCalled();
        expect(mocks.start).not.toHaveBeenCalled();
    });

    it('cancels without creating an inlay', async () => {
        const recording = {
            failure: pendingFailure(),
            finish: vi.fn(),
            cancel: vi.fn()
        };
        mocks.start.mockResolvedValue(recording);

        const running = runRecordAudio('chat-1');
        await vi.waitFor(() => expect(mocks.start).toHaveBeenCalledOnce());
        cancelRecordAudio('chat-1');
        await running;

        expect(recording.finish).not.toHaveBeenCalled();
        expect(mocks.createInlay).not.toHaveBeenCalled();
        expect(mocks.addDraftInlay).not.toHaveBeenCalled();
        expect(get(recordAudioTasks).has('chat-1')).toBe(false);
    });

    it('deletes an inlay that cannot be added to the draft', async () => {
        const recording = {
            failure: pendingFailure(),
            finish: vi.fn().mockResolvedValue({
                data: new Uint8Array([1]),
                mimeType: 'audio/webm'
            }),
            cancel: vi.fn()
        };
        mocks.start.mockResolvedValue(recording);
        mocks.createInlay.mockResolvedValue({ id: 'inlay-1' });
        mocks.addDraftInlay.mockReturnValue(false);

        const running = runRecordAudio('chat-1');
        await vi.waitFor(() => expect(mocks.start).toHaveBeenCalledOnce());
        finishRecordAudio('chat-1');
        await running;

        expect(mocks.deleteInlay).toHaveBeenCalledWith('chat-1', 'inlay-1');
        expect(get(recordAudioTasks).get('chat-1')).toMatchObject({
            status: 'error',
            phase: 'error'
        });

        dismissRecordAudio('chat-1');
        expect(get(recordAudioTasks).has('chat-1')).toBe(false);
    });
});
