/**
 * Mock Reranker Handler — Development / Testing
 */

import type { RankedResult, RerankerHandler } from '../types';

export type MockRerankerBehavior = 'sample' | 'diagnostic';

export interface MockRerankerConfig {
    behavior?: MockRerankerBehavior;
}

export class MockRerankerHandler implements RerankerHandler {
    private readonly behavior: MockRerankerBehavior;

    constructor(config: MockRerankerConfig = {}) {
        this.behavior = config.behavior ?? 'sample';
    }

    async rerank(query: string, documents: string[], signal: AbortSignal): Promise<RankedResult[]> {
        signal.throwIfAborted();
        const queryTokens = tokenize(query);
        const count = Math.max(1, documents.length);
        const results = documents.map((document, index) => {
            signal.throwIfAborted();
            return {
                index,
                score:
                    this.behavior === 'sample'
                        ? 1 - index / count
                        : overlapScore(queryTokens, tokenize(document))
            };
        });
        return results.sort((a, b) => b.score - a.score || a.index - b.index);
    }
}

function tokenize(text: string): Set<string> {
    return new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
}

function overlapScore(query: Set<string>, document: Set<string>): number {
    if (query.size === 0) return 0;
    let matches = 0;
    for (const token of query) {
        if (document.has(token)) matches += 1;
    }
    return matches / query.size;
}
