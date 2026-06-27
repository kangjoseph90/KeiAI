import type { Lorebook, PagedMessages } from '$lib/services';
import { runTemplate, createDryRunMacros, mergeLocalMacros } from '$lib/template';
import type { Macro } from '$lib/template';
import type { RuntimeContext } from '$lib/types/context';
import { toMessageContext } from './context';

export interface ResolveLorebookInput {
    lorebooks: Lorebook[];
    messages: PagedMessages;
    defaultScanDepth: number;
    ctx: RuntimeContext;
    localMacros?: ReadonlyMap<string, Macro>;
}

const MAX_RECURSIVE_ROUNDS = 20;

interface LorebookSearchContext {
    history: string[];
    recursive: string[];
    delta: string[]; // Newly added sources in the current round
}

export async function resolveLorebookEntries(input: ResolveLorebookInput): Promise<Lorebook[]> {
    const candidates = input.lorebooks.filter((lorebook) => !lorebook.disabled);
    if (candidates.length === 0) return [];

    const history = await buildScanHistory(input);
    const ctx: LorebookSearchContext = {
        history,
        recursive: [],
        delta: history
    };

    const resolved = new Map<string, Lorebook>();
    const probabilityRejected = new Set<string>();

    for (let round = 0; round < MAX_RECURSIVE_ROUNDS; round += 1) {
        const newlyResolved: Lorebook[] = [];

        for (const lorebook of candidates) {
            if (resolved.has(lorebook.id) || probabilityRejected.has(lorebook.id)) continue;

            // 1. Optimization: noRecursiveSearch lorebooks only care about the first round (history)
            if (round > 0 && lorebook.noRecursiveSearch) continue;

            // 2. Delta check (Optimization): Only check if it matches the latest information
            if (!lorebook.alwaysActive && !matchesAnyKey(lorebook, ctx.delta)) continue;

            // 3. Full activation check (History depth + Recursive all)
            if (!checkActivation(lorebook, ctx, input.defaultScanDepth)) continue;

            // 4. Random chance
            if (!passesProbability(lorebook.probability)) {
                probabilityRejected.add(lorebook.id);
                continue;
            }

            resolved.set(lorebook.id, lorebook);
            newlyResolved.push(lorebook);
        }

        if (newlyResolved.length === 0) break;

        const rendered = await buildRecursiveSources(newlyResolved, input);
        ctx.recursive.push(...rendered);
        ctx.delta = rendered;

        if (rendered.length === 0) break;
    }

    return [...resolved.values()];
}

async function buildScanHistory(input: ResolveLorebookInput): Promise<string[]> {
    const maxScanDepth = Math.max(
        0,
        ...input.lorebooks
            .filter((lorebook) => !lorebook.disabled)
            .map((lorebook) => lorebook.scanDepth ?? input.defaultScanDepth)
    );
    if (maxScanDepth <= 0) return [];

    const messages = await input.messages.slice(-maxScanDepth);
    const dryRunMacros = mergeLocalMacros(input.localMacros, createDryRunMacros());
    const rendered = await Promise.all(
        messages.map(({ message, index }) => {
            const activeSwipe = message.swipes[message.activeSwipeId];
            if (!activeSwipe) return '';
            return runTemplate(
                activeSwipe.content,
                toMessageContext(message, index, input.ctx),
                dryRunMacros
            );
        })
    );

    return rendered.filter((source) => source.trim().length > 0);
}

async function buildRecursiveSources(
    lorebooks: Lorebook[],
    input: ResolveLorebookInput
): Promise<string[]> {
    const recursiveLorebooks = lorebooks.filter((lorebook) => lorebook.recursive);
    if (recursiveLorebooks.length === 0) return [];

    const dryRunMacros = mergeLocalMacros(input.localMacros, createDryRunMacros());
    const rendered = await Promise.all(
        recursiveLorebooks.map((lorebook) => runTemplate(lorebook.content, input.ctx, dryRunMacros))
    );

    return rendered.filter((source) => source.trim().length > 0);
}

function checkActivation(
    lorebook: Lorebook,
    ctx: LorebookSearchContext,
    defaultScanDepth: number
): boolean {
    if (lorebook.alwaysActive) return true;

    const scanDepth = Math.max(0, lorebook.scanDepth ?? defaultScanDepth);
    const scopedHistory = scanDepth === 0 ? [] : ctx.history.slice(-scanDepth);

    const pools = lorebook.noRecursiveSearch ? [scopedHistory] : [scopedHistory, ctx.recursive];

    if (!matchesKeys(lorebook.key, pools, lorebook.useRegex)) return false;
    if (!lorebook.useMultipleKeys) return true;

    return matchesKeys(lorebook.secondKey, pools, lorebook.useRegex);
}

function matchesAnyKey(lorebook: Lorebook, sources: string[]): boolean {
    const primaryKeys = parseKeys(lorebook.key);
    if (hasAnyKeyMatch(primaryKeys, [sources], lorebook.useRegex)) return true;

    if (!lorebook.useMultipleKeys) return false;

    const secondaryKeys = parseKeys(lorebook.secondKey);
    return hasAnyKeyMatch(secondaryKeys, [sources], lorebook.useRegex);
}

function matchesKeys(rawKeys: string, pools: string[][], useRegex: boolean): boolean {
    const keys = parseKeys(rawKeys);
    if (keys.length === 0) return false;
    return hasAnyKeyMatch(keys, pools, useRegex);
}

function parseKeys(value: string): string[] {
    return value
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
}

function hasAnyKeyMatch(keys: string[], pools: string[][], useRegex: boolean): boolean {
    return keys.some((key) =>
        pools.some((pool) => pool.some((source) => matchesKey(source, key, useRegex)))
    );
}

function matchesKey(source: string, key: string, useRegex: boolean): boolean {
    if (useRegex) {
        try {
            return new RegExp(key, 'iu').test(source);
        } catch {
            return false;
        }
    }

    return source.toLowerCase().includes(key.toLowerCase());
}

function passesProbability(probability: number): boolean {
    const clamped = Math.max(0, Math.min(100, probability));
    if (clamped <= 0) return false;
    if (clamped >= 100) return true;
    return Math.random() * 100 < clamped;
}
