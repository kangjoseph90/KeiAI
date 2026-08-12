import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const releaseProxy = Symbol('releaseProxy');
    return {
        releaseProxy,
        remote: {
            embed: vi.fn(),
            rerank: vi.fn(),
            synthesize: vi.fn(),
            synthesizeKokoro: vi.fn(),
            transcribe: vi.fn(),
            generate: vi.fn(),
            cancel: vi.fn().mockResolvedValue(undefined),
            dispose: vi.fn(),
            disposeAll: vi.fn(),
            [releaseProxy]: vi.fn()
        },
        wrap: vi.fn(),
        proxy: vi.fn((callback: (...args: unknown[]) => unknown) => callback),
        transfer: vi.fn((value: unknown) => value),
        decodeAudio: vi.fn()
    };
});

vi.mock('comlink', () => ({
    releaseProxy: mocks.releaseProxy,
    wrap: mocks.wrap,
    proxy: mocks.proxy,
    transfer: mocks.transfer
}));

vi.mock('$lib/utils/audio', () => ({
    decodeAudio: mocks.decodeAudio
}));

class WorkerMock {
    static instances: WorkerMock[] = [];
    terminate = vi.fn();

    constructor(
        readonly url: URL,
        readonly options: WorkerOptions
    ) {
        WorkerMock.instances.push(this);
    }
}

describe('TransformersWorkerClient', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        WorkerMock.instances = [];
        vi.stubGlobal('Worker', WorkerMock);
        mocks.wrap.mockReturnValue(mocks.remote);
        mocks.remote.disposeAll.mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('reconstructs embedding views from one transferred buffer and reuses the worker', async () => {
        const data = new Float32Array([1, 2, 3, 4]);
        mocks.remote.embed.mockResolvedValue({
            data: data.buffer,
            count: 2,
            dimensions: 2
        });
        mocks.remote.rerank.mockResolvedValue([0.8]);
        const { TransformersWorkerClient } = await import('$lib/inference/worker-client');
        const client = new TransformersWorkerClient();

        const vectors = await client.embed({ modelId: 'embedding' }, ['a', 'b']);
        await client.rerank({ modelId: 'reranker' }, 'query', ['document']);

        expect(vectors.map((vector) => [...vector])).toEqual([
            [1, 2],
            [3, 4]
        ]);
        expect(vectors[0].buffer).toBe(vectors[1].buffer);
        expect(WorkerMock.instances).toHaveLength(1);
    });

    it('decodes Blob audio on the main thread and transfers PCM for STT', async () => {
        const samples = new Float32Array([0.25, -0.25]);
        mocks.decodeAudio.mockResolvedValue(samples);
        mocks.remote.transcribe.mockResolvedValue({ text: 'decoded' });
        const { TransformersWorkerClient } = await import('$lib/inference/worker-client');
        const client = new TransformersWorkerClient();

        await expect(
            client.transcribe({ modelId: 'stt' }, new Blob([new Uint8Array([1, 2])]))
        ).resolves.toEqual({ text: 'decoded' });

        expect(mocks.decodeAudio).toHaveBeenCalledOnce();
        expect(mocks.transfer).toHaveBeenCalledWith(samples, [samples.buffer]);
        expect(mocks.remote.transcribe).toHaveBeenCalledWith(
            expect.stringMatching(/^inference-/),
            { modelId: 'stt' },
            samples,
            {},
            undefined
        );
    });

    it('returns Kokoro WAV bytes synthesized by the worker', async () => {
        const wav = new Uint8Array([82, 73, 70, 70]);
        mocks.remote.synthesizeKokoro.mockResolvedValue({
            data: wav.buffer,
            mimeType: 'audio/wav'
        });
        const { TransformersWorkerClient } = await import('$lib/inference/worker-client');
        const client = new TransformersWorkerClient();
        const signal = new AbortController().signal;

        await expect(client.synthesizeKokoro('hello', 'af_heart', signal)).resolves.toEqual({
            data: wav,
            mimeType: 'audio/wav'
        });
        expect(mocks.remote.synthesizeKokoro).toHaveBeenCalledWith(
            expect.stringMatching(/^inference-/),
            'hello',
            'af_heart'
        );
    });

    it('bridges generation chunks in order and routes every runtime kind', async () => {
        mocks.remote.generate.mockImplementation(
            async (
                _operationId: string,
                _kind: string,
                _spec: unknown,
                _messages: unknown,
                _options: unknown,
                onText: (text: string) => void
            ) => {
                onText('first');
                onText('second');
            }
        );
        const { TransformersWorkerClient } = await import('$lib/inference/worker-client');
        const client = new TransformersWorkerClient();

        const chunks: string[] = [];
        for await (const chunk of client.generate('qwen35', { modelId: 'llm' }, [
            { role: 'user', content: [{ type: 'text', text: 'hello' }] }
        ])) {
            chunks.push(chunk);
        }

        expect(chunks).toEqual(['first', 'second']);
        expect(mocks.remote.generate).toHaveBeenCalledWith(
            expect.stringMatching(/^inference-/),
            'qwen35',
            { modelId: 'llm' },
            [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
            {},
            expect.any(Function),
            undefined
        );
    });

    it('cancels an active worker operation and rejects immediately', async () => {
        mocks.remote.embed.mockReturnValue(new Promise(() => undefined));
        const { TransformersWorkerClient } = await import('$lib/inference/worker-client');
        const client = new TransformersWorkerClient();
        const controller = new AbortController();

        const operation = client.embed({ modelId: 'embedding' }, ['text'], {
            signal: controller.signal
        });
        await vi.waitFor(() => expect(mocks.remote.embed).toHaveBeenCalledOnce());
        controller.abort();

        await expect(operation).rejects.toMatchObject({ name: 'AbortError' });
        expect(mocks.remote.cancel).toHaveBeenCalledWith(expect.stringMatching(/^inference-/));
    });

    it('cancels streaming generation and rejects the iterator with AbortError', async () => {
        mocks.remote.generate.mockReturnValue(new Promise(() => undefined));
        const { TransformersWorkerClient } = await import('$lib/inference/worker-client');
        const client = new TransformersWorkerClient();
        const controller = new AbortController();
        const iterator = client
            .generate('pipeline', { modelId: 'llm' }, [{ role: 'user', content: 'hello' }], {
                signal: controller.signal
            })
            [Symbol.asyncIterator]();

        const next = iterator.next();
        await vi.waitFor(() => expect(mocks.remote.generate).toHaveBeenCalledOnce());
        controller.abort();

        await expect(next).rejects.toMatchObject({ name: 'AbortError' });
        expect(mocks.remote.cancel).toHaveBeenCalledWith(expect.stringMatching(/^inference-/));
    });

    it('disposes runtimes, terminates the worker, and recreates it on demand', async () => {
        mocks.remote.embed.mockResolvedValue({ data: new ArrayBuffer(0), count: 0, dimensions: 0 });
        const { TransformersWorkerClient } = await import('$lib/inference/worker-client');
        const client = new TransformersWorkerClient();

        await client.embed({ modelId: 'first' }, []);
        await client.disposeAll();
        await client.embed({ modelId: 'second' }, []);

        expect(mocks.remote.disposeAll).toHaveBeenCalledOnce();
        expect(WorkerMock.instances[0].terminate).toHaveBeenCalledOnce();
        expect(WorkerMock.instances).toHaveLength(2);
    });
});
