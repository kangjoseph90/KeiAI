import type { PagedMessages } from '$lib/services/content/paged_messages';
import type { RuntimeContext } from '$lib/types/context';
import { AppError } from '$lib/types/errors';

export const MOCK_MEMORY_ALGORITHM_ID = 'mock';

export interface MemoryPhrase {
    content: string;
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

export async function resolveMemoryAlgorithm(
    algorithmId: string,
    input: MemoryAlgorithmInput
): Promise<MemoryPhrase[]> {
    if (input.signal.aborted) {
        throw new DOMException('The operation was aborted', 'AbortError');
    }
    if (algorithmId !== MOCK_MEMORY_ALGORITHM_ID) {
        throw new AppError('INVALID_INPUT', `Unknown memory algorithm: ${algorithmId}`);
    }

    // TODO: Replace the mock resolver with registered memory algorithms.
    return [{ content: `Memory range: [${input.start}, ${input.end})`, importance: 1 }];
}
