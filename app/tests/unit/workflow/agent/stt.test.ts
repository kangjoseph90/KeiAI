import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Chat } from '$lib/services';
import type { STTNode, WorkflowInput, WorkflowOutput } from '$lib/workflow/types';
import { serializeAgentParts } from '$lib/workflow/agent/llm';
import { executeSTTNode } from '$lib/workflow/agent/stt';

const { mockGetAppSettings, mockGetChat, mockReadBytes, mockLoad, mockSelect, mockTranscribe } =
    vi.hoisted(() => ({
        mockGetAppSettings: vi.fn(),
        mockGetChat: vi.fn(),
        mockReadBytes: vi.fn(),
        mockLoad: vi.fn(),
        mockSelect: vi.fn(),
        mockTranscribe: vi.fn()
    }));

vi.mock('$lib/stores', () => ({
    getAppSettings: mockGetAppSettings,
    getChat: mockGetChat
}));

vi.mock('$lib/services/asset', () => ({
    AssetService: {
        readBytes: mockReadBytes,
        load: mockLoad
    }
}));

vi.mock('$lib/stt', () => ({
    selectSTTHandler: mockSelect
}));

const node: STTNode = {
    id: 'stt-1',
    name: 'Speech to Text',
    class: 'STT',
    position: { x: 0, y: 0 },
    inputs: { audio: null },
    inputValues: { audio: '' }
};

const chat: Chat = {
    id: 'chat-1',
    roomId: 'room-1',
    scopeType: 'user',
    scopeId: 'user-1',
    title: 'Test',
    chatNote: '',
    messageCount: 0,
    personas: { refs: {}, folders: {} },
    lorebooks: { refs: {}, folders: {} },
    files: { refs: {}, folders: {} },
    inlays: {
        refs: {
            'audio-1': {
                id: 'audio-1',
                sortOrder: 'a',
                name: 'sample.wav',
                hash: 'audio-hash',
                encKey: 'audio-key',
                mimeType: 'audio/wav'
            },
            'audio-2': {
                id: 'audio-2',
                sortOrder: 'b',
                name: 'second.mp3',
                hash: 'second-hash',
                encKey: 'second-key',
                mimeType: 'audio/mpeg'
            }
        },
        folders: {}
    }
};

function input(value: string): WorkflowInput {
    return {
        subscribe: () => undefined,
        done: Promise.resolve({ status: 'value', value })
    };
}

describe('executeSTTNode', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetAppSettings.mockResolvedValue({ sttProvider: 'mock' });
        mockGetChat.mockResolvedValue(chat);
        mockReadBytes.mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
        mockTranscribe.mockResolvedValue({ text: 'transcribed text' });
        mockSelect.mockReturnValue({ transcribe: mockTranscribe });
    });

    it('loads one audio inlay and emits its transcript', async () => {
        const emit = vi.fn();
        const content = serializeAgentParts([{ type: 'inlay', ids: ['audio-1'] }]);

        await executeSTTNode({
            node,
            inputs: { audio: input(content) },
            output: { emit } satisfies WorkflowOutput,
            emitRuntimeOutput: vi.fn(),
            ctx: { chatId: chat.id },
            signal: new AbortController().signal
        });

        const audio = mockTranscribe.mock.calls[0][0] as File;
        expect(audio.name).toBe('sample.wav');
        expect(audio.type).toBe('audio/wav');
        expect(emit).toHaveBeenCalledWith(0, {
            status: 'value',
            value: 'transcribed text'
        });
    });

    it('transcribes multiple audio inlays sequentially and concatenates the results', async () => {
        const emit = vi.fn();
        const content = serializeAgentParts([{ type: 'inlay', ids: ['audio-1', 'audio-2'] }]);
        mockTranscribe.mockResolvedValueOnce({ text: 'first' }).mockResolvedValueOnce({
            text: 'second'
        });

        await executeSTTNode({
            node,
            inputs: { audio: input(content) },
            output: { emit } satisfies WorkflowOutput,
            emitRuntimeOutput: vi.fn(),
            ctx: { chatId: chat.id },
            signal: new AbortController().signal
        });

        expect(mockTranscribe).toHaveBeenCalledTimes(2);
        expect((mockTranscribe.mock.calls[0][0] as File).name).toBe('sample.wav');
        expect((mockTranscribe.mock.calls[1][0] as File).name).toBe('second.mp3');
        expect(emit).toHaveBeenCalledWith(0, {
            status: 'value',
            value: 'first\nsecond'
        });
    });
});
