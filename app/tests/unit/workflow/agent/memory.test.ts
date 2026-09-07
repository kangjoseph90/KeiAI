import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    listMemoryAlgorithms,
    MEMORY_ALGORITHM_REGISTRY,
    MOCK_MEMORY_ALGORITHM_ID,
    resolveMemoryAlgorithm,
    type MemoryAlgorithmInput
} from '$lib/workflow/agent/memory';
import type { PagedMessages } from '$lib/services/content/paged_messages';
import { AppError } from '$lib/types/errors';

const { mockSemanticResolve } = vi.hoisted(() => ({ mockSemanticResolve: vi.fn() }));

// The semantic algorithm reaches app settings through retrieval; the registry contract
// under test does not need that graph loaded.
vi.mock('$lib/workflow/agent/memory_semantic', () => ({
    SEMANTIC_MEMORY_ALGORITHM_ID: 'semantic',
    SEMANTIC_MEMORY_ALGORITHM: {
        id: 'semantic',
        label: 'Semantic Retrieval',
        resolve: mockSemanticResolve
    }
}));

function makeInput(overrides: Partial<MemoryAlgorithmInput> = {}): MemoryAlgorithmInput {
    return {
        messages: { length: 4 } as unknown as PagedMessages,
        start: 0,
        end: 2,
        config: {},
        ctx: {},
        signal: new AbortController().signal,
        ...overrides
    };
}

describe('memory algorithm registry', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSemanticResolve.mockResolvedValue([]);
    });

    it('lists every built-in algorithm with a label', () => {
        expect(listMemoryAlgorithms().map(({ id, label }) => ({ id, label }))).toEqual([
            { id: 'mock', label: 'Mock' },
            { id: 'semantic', label: 'Semantic Retrieval' }
        ]);
    });

    it('keeps the mock id registered because stored blocks and imports use the literal', () => {
        expect(MOCK_MEMORY_ALGORITHM_ID in MEMORY_ALGORITHM_REGISTRY).toBe(true);
        expect('semantic' in MEMORY_ALGORITHM_REGISTRY).toBe(true);
    });

    it('resolves the mock algorithm to the requested range', async () => {
        await expect(
            resolveMemoryAlgorithm('mock', makeInput({ start: 1, end: 5 }))
        ).resolves.toEqual([{ content: 'Memory range: [1, 5)', importance: 1 }]);
    });

    it('dispatches to the registered algorithm', async () => {
        const input = makeInput();
        mockSemanticResolve.mockResolvedValue([{ content: 'remembered', importance: 2 }]);

        await expect(resolveMemoryAlgorithm('semantic', input)).resolves.toEqual([
            { content: 'remembered', importance: 2 }
        ]);
        expect(mockSemanticResolve).toHaveBeenCalledWith(input);
    });

    it('rejects an unknown algorithm id', async () => {
        await expect(resolveMemoryAlgorithm('nope', makeInput())).rejects.toThrow(AppError);
        await expect(resolveMemoryAlgorithm('nope', makeInput())).rejects.toThrow(
            'Unknown memory algorithm: nope'
        );
    });

    it('aborts before dispatching', async () => {
        const controller = new AbortController();
        controller.abort();

        await expect(
            resolveMemoryAlgorithm('semantic', makeInput({ signal: controller.signal }))
        ).rejects.toMatchObject({ name: 'AbortError' });
        expect(mockSemanticResolve).not.toHaveBeenCalled();
    });
});
