/**
 * Memory Algorithms — KeiAI
 *
 * Resolves a memory prompt block's range into ranked phrases.
 * Algorithms only select and rank; the Prompt Builder owns budgeting and formatting.
 */

import type { PagedMessages } from '$lib/services/content/paged_messages';
import type { RuntimeContext } from '$lib/types/context';
import { AppError } from '$lib/types/errors';
import { SEMANTIC_MEMORY_ALGORITHM } from './memory_semantic';

export const MOCK_MEMORY_ALGORITHM_ID = 'mock';

export interface MemoryPhrase {
    content: string;
    /** Selection priority under the block budget. Emission order follows array order. */
    importance: number;
}

export interface MemoryAlgorithmInput {
    messages: PagedMessages;
    start: number;
    end: number;
    config: Record<string, unknown>;
    ctx: RuntimeContext;
    signal: AbortSignal;
}

export interface MemoryAlgorithmDefinition {
    id: string;
    label: string;
    resolve(input: MemoryAlgorithmInput): Promise<MemoryPhrase[]>;
}

const MOCK_MEMORY_ALGORITHM: MemoryAlgorithmDefinition = {
    id: MOCK_MEMORY_ALGORITHM_ID,
    label: 'Mock',
    resolve: async (input) => [
        { content: `Memory range: [${input.start}, ${input.end})`, importance: 1 }
    ]
};

export const MEMORY_ALGORITHM_REGISTRY = {
    [MOCK_MEMORY_ALGORITHM_ID]: MOCK_MEMORY_ALGORITHM,
    semantic: SEMANTIC_MEMORY_ALGORITHM
} satisfies Record<string, MemoryAlgorithmDefinition>;

export type BuiltInMemoryAlgorithmId = keyof typeof MEMORY_ALGORITHM_REGISTRY;

export function listMemoryAlgorithms(): MemoryAlgorithmDefinition[] {
    return Object.values(MEMORY_ALGORITHM_REGISTRY);
}

export function requireMemoryAlgorithm(algorithmId: string): MemoryAlgorithmDefinition {
    const algorithm = MEMORY_ALGORITHM_REGISTRY[algorithmId as BuiltInMemoryAlgorithmId];
    if (!algorithm) {
        throw new AppError('INVALID_INPUT', `Unknown memory algorithm: ${algorithmId}`);
    }
    return algorithm;
}

export async function resolveMemoryAlgorithm(
    algorithmId: string,
    input: MemoryAlgorithmInput
): Promise<MemoryPhrase[]> {
    input.signal.throwIfAborted();
    return requireMemoryAlgorithm(algorithmId).resolve(input);
}
