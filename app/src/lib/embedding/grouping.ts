import { AppError } from '$lib/types/errors';

export function groupEmbeddingVectors(
    vectors: Float32Array[],
    groupSizes: number[]
): Float32Array[][] {
    const expectedCount = groupSizes.reduce((total, size) => total + size, 0);
    if (vectors.length !== expectedCount) {
        throw new AppError('NETWORK_ERROR', 'Embedding returned an invalid vector count');
    }

    const groups: Float32Array[][] = [];
    let offset = 0;
    for (const size of groupSizes) {
        groups.push(vectors.slice(offset, offset + size));
        offset += size;
    }
    return groups;
}
