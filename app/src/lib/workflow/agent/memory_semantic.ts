/**
 * Semantic Memory Algorithm — KeiAI
 *
 * Ranks the messages a memory block covers by embedding similarity to the recent
 * conversation, so history that fell outside the context window can be surfaced again.
 */

import { createLogger } from '$lib/adapters/logger';
// Imported from the module instead of the $lib/managers barrel: the barrel re-exports
// managers/workflow, which imports $lib/workflow and closes an import cycle back here.
import { searchDocuments, type RetrievalDocument } from '$lib/managers/retrieval';
import type { Message } from '$lib/services/content/message';
import type { IndexedMessage } from '$lib/services/content/paged_messages';
import { createDryRunMacros, runTemplate } from '$lib/template';
import type { RuntimeContext } from '$lib/types/context';
import { AppError } from '$lib/types/errors';
import { toMessageContext } from './context';
import { getLastTextContent } from './llm';
import type { MemoryAlgorithmDefinition, MemoryAlgorithmInput, MemoryPhrase } from './memory';

const logger = createLogger('workflow:memory');

export const SEMANTIC_MEMORY_ALGORITHM_ID = 'semantic';

export interface SemanticMemoryConfig {
    /** Newest messages outside the range that form the search query. */
    queryDepth: number;
    /**
     * Messages per embedding document. Chunks in a group may share embedding context,
     * but the document cache key hashes the whole chunk array, so editing one message
     * re-embeds its entire group.
     */
    groupSize: number;
    /** Phrases requested from retrieval. The block budget is a ceiling, not a policy. */
    topK: number;
    /** Newest candidate messages considered, bounding the first build on a long chat. */
    maxCandidates: number;
}

const DEFAULT_CONFIG: SemanticMemoryConfig = {
    queryDepth: 3,
    groupSize: 4,
    topK: 8,
    maxCandidates: 256
};

interface MemoryCandidate {
    index: number;
    message: Message;
    text: string;
}

export const SEMANTIC_MEMORY_ALGORITHM: MemoryAlgorithmDefinition = {
    id: SEMANTIC_MEMORY_ALGORITHM_ID,
    label: 'Semantic Retrieval',
    resolve: resolveSemanticMemory
};

async function resolveSemanticMemory(input: MemoryAlgorithmInput): Promise<MemoryPhrase[]> {
    input.signal.throwIfAborted();

    const config = parseSemanticMemoryConfig(input.config);
    const { messages } = input;
    const start = messages.normalizeIndex(input.start);
    const end = messages.normalizeIndex(input.end);
    if (start >= end) return [];

    // The query is the conversation the range does not cover. When nothing follows the
    // range, fall back to its newest messages and drop them from the candidate set so a
    // message cannot retrieve itself.
    const hasTail = end < messages.length;
    const queryStart = hasTail
        ? Math.max(end, messages.length - config.queryDepth)
        : Math.max(start, end - config.queryDepth);
    const queryEnd = hasTail ? messages.length : end;
    // Rounded down to a window boundary so the trailing window is never partial. The
    // document cache key covers a whole window, so admitting a window that grows by one
    // message per turn would re-embed it every turn; this way each window is embedded
    // once, when it fills. The cost is that the newest few messages the range covers wait
    // up to groupSize turns to become candidates.
    const candidateEnd =
        Math.floor((hasTail ? end : queryStart) / config.groupSize) * config.groupSize;
    const candidateStart = Math.max(start, candidateEnd - config.maxCandidates);
    if (candidateStart >= candidateEnd) return [];

    const [candidateSlice, querySlice] = await Promise.all([
        messages.slice(candidateStart, candidateEnd),
        messages.slice(queryStart, queryEnd)
    ]);
    input.signal.throwIfAborted();

    const [candidates, queryMessages] = await Promise.all([
        renderCandidates(candidateSlice, input.ctx),
        renderCandidates(querySlice, input.ctx)
    ]);
    input.signal.throwIfAborted();

    const query = queryMessages.map(({ text }) => text).join('\n');
    if (candidates.length === 0 || !query.trim()) {
        logger.debug('Skipping semantic memory: no candidate or query text', { start, end });
        return [];
    }

    const documents: RetrievalDocument[] = [];
    const documentCandidates: MemoryCandidate[][] = [];
    let currentWindow = -1;
    for (const candidate of candidates) {
        // Windows align on the absolute message index so they stay cache-stable when the
        // block range shifts.
        const window = Math.floor(candidate.index / config.groupSize);
        if (window !== currentWindow) {
            currentWindow = window;
            documents.push({ chunks: [] });
            documentCandidates.push([]);
        }
        documents[documents.length - 1].chunks.push(candidate.text);
        documentCandidates[documentCandidates.length - 1].push(candidate);
    }

    const results = await searchDocuments(query, documents, input.signal, config.topK);
    input.signal.throwIfAborted();

    // Rank, not raw score: retrieval already resolved score ties deterministically.
    const selected = results.map((result, rank) => ({
        candidate: documentCandidates[result.documentIndex][result.chunkIndex],
        importance: results.length - rank
    }));
    // Emitted in chronological order; importance only decides what survives the budget.
    selected.sort((left, right) => left.candidate.index - right.candidate.index);

    return Promise.all(
        selected.map(async ({ candidate, importance }) => ({
            content: `${await resolveSpeakerLabel(candidate, input.ctx)}: ${candidate.text}`,
            importance
        }))
    );
}

function parseSemanticMemoryConfig(config: Record<string, unknown>): SemanticMemoryConfig {
    for (const field of Object.keys(config)) {
        if (!(field in DEFAULT_CONFIG)) {
            throw new AppError('INVALID_INPUT', `Unknown semantic memory config field: ${field}`);
        }
    }
    return {
        queryDepth: readPositiveInteger(config, 'queryDepth'),
        groupSize: readPositiveInteger(config, 'groupSize'),
        topK: readPositiveInteger(config, 'topK'),
        maxCandidates: readPositiveInteger(config, 'maxCandidates')
    };
}

function readPositiveInteger(
    config: Record<string, unknown>,
    field: keyof SemanticMemoryConfig
): number {
    const value = config[field];
    if (value === undefined) return DEFAULT_CONFIG[field];
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
        throw new AppError('INVALID_INPUT', `Semantic memory ${field} must be a positive integer`);
    }
    return value;
}

/**
 * Renders the user-facing text of each message, dropping the empty ones.
 *
 * Thoughts and tool traces are execution metadata and must not drive retrieval, and the
 * request pipeline is deliberately skipped: it is user scripting with side effects and
 * would run once per candidate.
 */
async function renderCandidates(
    slice: IndexedMessage[],
    ctx: RuntimeContext
): Promise<MemoryCandidate[]> {
    const dryRunMacros = createDryRunMacros();
    const rendered = await Promise.all(
        slice.map(async ({ message, index }): Promise<MemoryCandidate | null> => {
            const activeSwipe = message.swipes[message.activeSwipeId];
            if (!activeSwipe) return null;
            const text = (
                await runTemplate(
                    getLastTextContent(activeSwipe.parts),
                    toMessageContext(message, index, ctx),
                    dryRunMacros
                )
            ).trim();
            return text ? { index, message, text } : null;
        })
    );
    return rendered.filter((candidate): candidate is MemoryCandidate => candidate !== null);
}

/**
 * Phrase text is the only place a memory can carry message identity: the Prompt Builder
 * renders phrases under a role context with no message macros. The label is kept out of
 * the embedded chunk so renaming a persona does not invalidate the chat's embeddings.
 */
async function resolveSpeakerLabel(
    candidate: MemoryCandidate,
    ctx: RuntimeContext
): Promise<string> {
    const speaker = (
        await runTemplate('{{speaker}}', toMessageContext(candidate.message, candidate.index, ctx))
    ).trim();
    return speaker || candidate.message.role;
}
