import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SEMANTIC_MEMORY_ALGORITHM } from '$lib/workflow/agent/memory_semantic';
import type { MemoryAlgorithmInput } from '$lib/workflow/agent/memory';
import type { Message } from '$lib/services';
import type { PagedMessages } from '$lib/services/content/paged_messages';
import type { RuntimeContext } from '$lib/types/context';
import { AppError } from '$lib/types/errors';

const { mockSearchDocuments, mockRunTemplate } = vi.hoisted(() => ({
    mockSearchDocuments: vi.fn(),
    mockRunTemplate: vi.fn()
}));

vi.mock('$lib/managers/retrieval', () => ({
    searchDocuments: mockSearchDocuments
}));

// runTemplate is impure; the rest of $lib/template is pure.
vi.mock('$lib/template', async (importOriginal) => {
    const actual = await importOriginal<typeof import('$lib/template')>();
    return { ...actual, runTemplate: mockRunTemplate };
});

function makeMessage(
    index: number,
    content: string,
    overrides: { role?: Message['role']; speakerName?: string } = {}
): Message {
    const id = `msg-${index}`;
    const swipeId = `${id}-swipe`;
    return {
        id,
        chatId: 'chat-1',
        scopeType: 'user',
        scopeId: 'user-1',
        sortOrder: id,
        role: overrides.role ?? (index % 2 === 0 ? 'user' : 'assistant'),
        activeSwipeId: swipeId,
        swipes: {
            [swipeId]: {
                id: swipeId,
                parts: [{ type: 'text', text: content }],
                createdAt: 1,
                speakerName: overrides.speakerName
            }
        }
    };
}

/** `count` messages whose text is its own index, so assertions read as `m<index>`. */
function makeMessages(count: number, blanks: number[] = []): Message[] {
    return Array.from({ length: count }, (_, index) =>
        makeMessage(index, blanks.includes(index) ? '   ' : `m${index}`)
    );
}

function makePagedMessages(messages: Message[]): PagedMessages {
    const length = messages.length;
    const normalizeIndex = (value: number) => {
        const integer = Number.isNaN(value) ? 0 : Math.trunc(value);
        if (integer === Infinity) return length;
        if (integer === -Infinity) return 0;
        return Math.min(length, Math.max(0, integer < 0 ? length + integer : integer));
    };
    return {
        length,
        normalizeIndex: vi.fn(normalizeIndex),
        slice: vi.fn(async (start?: number, end?: number) => {
            const from = normalizeIndex(start ?? 0);
            const to = normalizeIndex(end ?? length);
            if (from >= to) return [];
            return messages
                .slice(from, to)
                .map((message, offset) => ({ message, index: from + offset }));
        })
    } as unknown as PagedMessages;
}

function makeInput(overrides: Partial<MemoryAlgorithmInput> = {}): MemoryAlgorithmInput {
    return {
        messages: makePagedMessages(makeMessages(10)),
        start: 2,
        end: 9,
        config: {},
        ctx: { chatId: 'chat-1' },
        signal: new AbortController().signal,
        ...overrides
    };
}

function resolve(overrides: Partial<MemoryAlgorithmInput> = {}) {
    return SEMANTIC_MEMORY_ALGORITHM.resolve(makeInput(overrides));
}

function documentChunks(): string[][] {
    const [, documents] = mockSearchDocuments.mock.calls[0];
    return (documents as Array<{ chunks: string[] }>).map(({ chunks }) => chunks);
}

describe('semantic memory algorithm', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockRunTemplate.mockImplementation(async (text: string, ctx: RuntimeContext) =>
            text === '{{speaker}}' ? (ctx.speakerName ?? '') : text
        );
        mockSearchDocuments.mockResolvedValue([]);
    });

    it('groups candidates into windows aligned on the absolute message index', async () => {
        await resolve();

        expect(mockSearchDocuments).toHaveBeenCalledTimes(1);
        expect(documentChunks()).toEqual([
            ['m2', 'm3'],
            ['m4', 'm5', 'm6', 'm7']
        ]);
    });

    it('withholds the trailing partial window so a window is embedded only once', async () => {
        // Window 2 would hold m8 alone, and admitting it would re-embed the window on
        // every turn as it fills.
        await resolve();
        expect(documentChunks().flat()).not.toContain('m8');

        mockSearchDocuments.mockClear();
        await resolve({ messages: makePagedMessages(makeMessages(13)), start: 2, end: 12 });

        // end already sits on a window boundary, so nothing is withheld.
        expect(documentChunks().flat()).toContain('m11');
    });

    it('queries with the newest messages after the range and excludes them from candidates', async () => {
        await resolve();

        const [query, , signal, topK] = mockSearchDocuments.mock.calls[0];
        expect(query).toBe('m9');
        expect(documentChunks().flat()).not.toContain('m9');
        expect(signal).toBeInstanceOf(AbortSignal);
        expect(topK).toBe(8);
    });

    it('falls back to the newest in-range messages when nothing follows the range', async () => {
        await resolve({
            messages: makePagedMessages(makeMessages(6)),
            start: 0,
            end: 6,
            config: { queryDepth: 2 }
        });

        const [query] = mockSearchDocuments.mock.calls[0];
        expect(query).toBe('m4\nm5');
        expect(documentChunks()).toEqual([['m0', 'm1', 'm2', 'm3']]);
    });

    it('maps results back through the filtered chunk list, not by arithmetic', async () => {
        mockSearchDocuments.mockResolvedValue([{ documentIndex: 1, chunkIndex: 1, score: 0.9 }]);

        const phrases = await resolve({ messages: makePagedMessages(makeMessages(10, [5])) });

        expect(documentChunks()).toEqual([
            ['m2', 'm3'],
            ['m4', 'm6', 'm7']
        ]);
        expect(phrases).toEqual([{ content: 'user: m6', importance: 1 }]);
    });

    it('drops windows whose messages all render empty', async () => {
        await resolve({ messages: makePagedMessages(makeMessages(10, [4, 5, 6, 7])) });

        expect(documentChunks()).toEqual([['m2', 'm3']]);
    });

    it('returns nothing for an empty range without searching', async () => {
        await expect(resolve({ start: 5, end: 5 })).resolves.toEqual([]);
        expect(mockSearchDocuments).not.toHaveBeenCalled();
    });

    it('returns nothing when the query renders empty instead of failing the prompt', async () => {
        await expect(
            resolve({ messages: makePagedMessages(makeMessages(10, [9])) })
        ).resolves.toEqual([]);
        expect(mockSearchDocuments).not.toHaveBeenCalled();
    });

    it('emits phrases in chronological order while importance ranks relevance', async () => {
        mockSearchDocuments.mockResolvedValue([
            { documentIndex: 1, chunkIndex: 2, score: 0.9 },
            { documentIndex: 0, chunkIndex: 0, score: 0.4 }
        ]);

        const phrases = await resolve();

        expect(phrases).toEqual([
            { content: 'user: m2', importance: 1 },
            { content: 'user: m6', importance: 2 }
        ]);
    });

    it('prefixes the speaker without embedding it', async () => {
        const messages = makeMessages(10);
        messages[2] = makeMessage(2, 'm2', { speakerName: 'Alice' });
        messages[3] = makeMessage(3, 'm3', { role: 'system' });
        mockSearchDocuments.mockResolvedValue([
            { documentIndex: 0, chunkIndex: 0, score: 0.9 },
            { documentIndex: 0, chunkIndex: 1, score: 0.8 }
        ]);

        const phrases = await resolve({ messages: makePagedMessages(messages) });

        expect(phrases.map(({ content }) => content)).toEqual(['Alice: m2', 'system: m3']);
        expect(documentChunks()[0]).toEqual(['m2', 'm3']);
    });

    it('clamps candidates to the newest maxCandidates messages', async () => {
        await resolve({
            messages: makePagedMessages(makeMessages(21)),
            start: 0,
            end: 20,
            config: { maxCandidates: 5 }
        });

        expect(documentChunks()).toEqual([['m15'], ['m16', 'm17', 'm18', 'm19']]);
    });

    it('passes a configured topK through to retrieval', async () => {
        await resolve({ config: { topK: 3 } });

        expect(mockSearchDocuments.mock.calls[0][3]).toBe(3);
    });

    it.each([
        ['queryDepth', 0],
        ['queryDepth', 1.5],
        ['groupSize', -1],
        ['topK', '3'],
        ['maxCandidates', 0]
    ])('rejects an invalid %s', async (field, value) => {
        await expect(resolve({ config: { [field]: value } })).rejects.toThrow(
            `Semantic memory ${field} must be a positive integer`
        );
    });

    it('rejects an unknown config field so a typo is not a silent no-op', async () => {
        await expect(resolve({ config: { querydepth: 3 } })).rejects.toThrow(AppError);
        await expect(resolve({ config: { querydepth: 3 } })).rejects.toThrow(
            'Unknown semantic memory config field: querydepth'
        );
    });

    it('aborts before searching', async () => {
        const controller = new AbortController();
        controller.abort();

        await expect(resolve({ signal: controller.signal })).rejects.toMatchObject({
            name: 'AbortError'
        });
        expect(mockSearchDocuments).not.toHaveBeenCalled();
    });

    it('aborts after loading messages', async () => {
        const controller = new AbortController();
        const loaded = makePagedMessages(makeMessages(10));
        const messages = {
            length: loaded.length,
            normalizeIndex: (value: number) => loaded.normalizeIndex(value),
            slice: vi.fn(async (start?: number, end?: number) => {
                controller.abort();
                return loaded.slice(start, end);
            })
        } as unknown as PagedMessages;

        await expect(resolve({ messages, signal: controller.signal })).rejects.toMatchObject({
            name: 'AbortError'
        });
        expect(mockSearchDocuments).not.toHaveBeenCalled();
    });

    it('propagates retrieval failures with their cause intact', async () => {
        const cause = new Error('401');
        mockSearchDocuments.mockRejectedValue(
            new AppError('NETWORK_ERROR', 'Embedding request failed', cause)
        );

        await expect(resolve()).rejects.toMatchObject({
            code: 'NETWORK_ERROR',
            cause
        });
    });
});
