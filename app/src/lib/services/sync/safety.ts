/**
 * Merge safety for tombstone GC.
 *
 * A replica that garbage-collects a tombstone forgets that deletion. Merging with a replica
 * that still holds the record live would silently resurrect it, so every scope session first
 * proves, in both directions, that the peer knows every deletion this side has forgotten.
 * The proof is the direct relationship cursor or a shared History–Clean checkpoint.
 *
 * Replicas also carry a lineage: replicas of different lineages never merge. A replica with
 * nothing to lose takes over its peer's state instead (bootstrap of an empty server, adoption
 * by an empty client); anything else that cannot be proven waits for the user to choose.
 * The invariants and their argument are documented in docs/sync-gc.md.
 */

import { pb } from '$lib/adapters/pb';
import { localDB, type DataScope, type SyncCheckpoint } from '$lib/adapters/db';
import type { SyncCursorState } from '$lib/adapters/sync';
import { AppError, isErrorCode } from '$lib/types/errors';
import { assertSyncServer, type SyncScope } from './utils';

const DAY_MS = 24 * 60 * 60 * 1000;

/** A tombstone is kept at least this long after this replica first holds it. */
export const TOMBSTONE_RETENTION_MS = 30 * DAY_MS;
/** A session issues a new checkpoint when this replica co-issued none more recently. */
export const CHECKPOINT_INTERVAL_MS = DAY_MS;
/** Checkpoints are only useful while some replica is still clean on them. */
export const CHECKPOINT_RETENTION_MS = 2 * TOMBSTONE_RETENTION_MS;

/**
 * Checkpoints offered per request, well below the server's id limit. Inherited checkpoints
 * accumulate per member and day, so a busy room scope can hold more than a request carries.
 */
const MAX_OFFERED_CHECKPOINTS = 500;

/** Request header that carries the server-side coverage of this client on Push. */
export const SYNC_COVERAGE_HEADER = 'X-Kei-Sync-Coverage';
/** Request header naming the lineage a Push was proven against. */
export const SYNC_LINEAGE_HEADER = 'X-Kei-Sync-Lineage';
/** Request header carrying the token of the bootstrap that may write an initializing scope. */
export const SYNC_BOOTSTRAP_HEADER = 'X-Kei-Sync-Bootstrap';

export interface ReplicaSafety {
    /** Highest own position of a forgotten deletion. */
    gcHigh: number;
    /** Highest own position whose forgotten deletions the peer provably knows. */
    coverage: number;
}

/**
 * - `sync`: same lineage, both directions proven.
 * - `adopt`: this client holds nothing; it replaces its replica with the server's.
 * - `bootstrap`: the server holds nothing (or this client's interrupted bootstrap); fill it.
 * - `wait`: another client is initializing the server's scope.
 * - `conflict`: both hold data that cannot be merged safely; the user must choose.
 * - `init`: this never-synced client holds data, and the server holds another replica.
 */
export type SessionPlan = 'sync' | 'adopt' | 'bootstrap' | 'wait' | 'conflict' | 'init';

export interface LocalReplica {
    lineage: string | null;
    /** Lineage of this client's own unfinished bootstrap of this server, if any. */
    pendingLineage: string | null;
    hasRecords: boolean;
    safety: ReplicaSafety;
}

export interface RemoteReplica {
    lineage: string | null;
    initializing: 'active' | 'stale' | null;
    hasRecords: boolean;
    safety: ReplicaSafety;
}

/** Both directions are proven: each side's forgotten deletions are known by the other. */
export function mergeCovered(local: ReplicaSafety, remote: ReplicaSafety): boolean {
    return local.gcHigh <= local.coverage && remote.gcHigh <= remote.coverage;
}

/**
 * Lineage first, then History–Clean. Only a replica with no records is replaced without
 * asking: it has nothing to lose. A bare watermark of zero never stands in for an empty or
 * initialized replica.
 */
export function planSession(local: LocalReplica, remote: RemoteReplica): SessionPlan {
    if (remote.initializing) {
        // Only the bootstrapping replica knows what the partial server state lacks; another
        // replica of the same lineage may not know the deletions it was filled with.
        if (local.pendingLineage !== null && remote.lineage === local.pendingLineage) {
            return 'bootstrap';
        }
        return remote.initializing === 'stale' && local.hasRecords ? 'conflict' : 'wait';
    }
    if (remote.lineage === null) {
        if (!remote.hasRecords) return 'bootstrap';
        return local.hasRecords ? 'conflict' : 'adopt';
    }
    const lineage = currentLineage(local, remote);
    if (lineage === null) return local.hasRecords ? 'init' : 'adopt';
    if (lineage === remote.lineage && mergeCovered(local.safety, remote.safety)) {
        return 'sync';
    }
    return local.hasRecords ? 'conflict' : 'adopt';
}

/**
 * This replica's lineage on the server. A pending bootstrap whose lineage the server holds
 * outside a lease was committed, even if this client never saw the response.
 */
export function currentLineage(
    local: Pick<LocalReplica, 'lineage' | 'pendingLineage'>,
    remote: Pick<RemoteReplica, 'lineage' | 'initializing'>
): string | null {
    return !remote.initializing &&
        local.pendingLineage !== null &&
        remote.lineage === local.pendingLineage
        ? local.pendingLineage
        : local.lineage;
}

/** How a prepared session runs: under a given lineage, or as part of a bootstrap/adoption. */
export interface SessionContext {
    lineage: string;
    bootstrapToken?: string;
    adoptedGcHigh?: number;
}

export interface SyncSession {
    /** This client's forgotten deletions known by the server, in local revisions. */
    localCoverage: number;
    /** The server's forgotten deletions known by this client, in server positions. */
    serverCoverage: number;
    /** Checkpoints this client offered when the session opened. */
    checkpoints: SyncCheckpoint[];
    /** Lineage both replicas share for this session. */
    lineage: string;
    bootstrapToken?: string;
    adoptedGcHigh?: number;
}

export interface OpenedSession {
    plan: SessionPlan;
    session: SyncSession;
    /** The server's lineage as of the handshake: what a user resolves a conflict against. */
    remoteLineage: string | null;
}

export interface SessionBounds {
    cursors: SyncCursorState;
    /** Pull upper bound of the session, in server positions. */
    serverUpper: number;
    /** Push upper bound of the session, in local revisions. */
    localUpper: number;
    /** Whether every local change through `localUpper` reached the server. */
    pushed: boolean;
}

/**
 * Coverage is the cursor of the direct relationship raised to the anchor of any checkpoint
 * this side is anchored on and the peer also holds. Forgotten deletions at or below it are
 * known by the peer; Clean holds exactly when `gcHigh <= coverage`.
 */
export function coverage(
    cursor: number,
    checkpoints: ReadonlyArray<Pick<SyncCheckpoint, 'id' | 'anchor'>>,
    peerHolds: ReadonlySet<string>
): number {
    return checkpoints.reduce(
        (high, checkpoint) =>
            peerHolds.has(checkpoint.id) ? Math.max(high, checkpoint.anchor) : high,
        cursor
    );
}

/**
 * Prove both merge directions and decide how the scope proceeds, before any Pull or Push.
 * A prepared session (bootstrap or adoption) runs under its context and must prove `sync`.
 */
export async function openSyncSession(
    syncScope: SyncScope,
    serverUrl: string,
    cursors: SyncCursorState,
    local: Omit<LocalReplica, 'safety'>,
    context?: SessionContext
): Promise<OpenedSession> {
    const { scope } = syncScope;
    const [gcHigh, held] = await Promise.all([
        localDB.getSyncGcHigh(scope),
        localDB.getSyncCheckpoints(scope)
    ]);
    const checkpoints = offeredCheckpoints(held);
    const response = await post(serverUrl, '/api/sync/handshake', {
        ...scope,
        pullCursor: cursors.serverPullCursor,
        checkpoints: checkpoints.map(({ id }) => id),
        bootstrapToken: context?.bootstrapToken
    });
    const serverCoverage = readNumber(response.coverage);
    const known = new Set(readIds(response.known));
    const localCoverage = coverage(cursors.localPushCursor, checkpoints, known);
    const remote: RemoteReplica = {
        lineage: readLineage(response.lineage),
        initializing: readInitializing(response.initializing),
        hasRecords: response.hasRecords === true,
        safety: { gcHigh: readNumber(response.gcHigh), coverage: serverCoverage }
    };
    const remoteLineage = remote.lineage;
    const lineage = context?.lineage ?? currentLineage(local, remote);
    const plan = planSession(
        { ...local, lineage, safety: { gcHigh, coverage: localCoverage } },
        remote
    );
    if (context && plan !== 'sync') {
        throw new AppError('SYNC_UNSAFE', `Prepared ${scopeLabel(scope)} did not verify`);
    }
    return {
        plan,
        remoteLineage,
        session: {
            localCoverage,
            serverCoverage,
            checkpoints,
            lineage: lineage ?? '',
            bootstrapToken: context?.bootstrapToken,
            adoptedGcHigh: context?.adoptedGcHigh
        }
    };
}

/**
 * Start filling the server's scope from this replica. The server replaces the scope's state
 * in one transaction and stays initializing until this bootstrap commits.
 */
export async function beginBootstrap(
    syncScope: SyncScope,
    serverUrl: string,
    request: {
        mode: 'init' | 'overwrite';
        expectedLineage: string | null;
        lineage: string;
        checkpoint: string;
        forgotten: boolean;
        /** Checkpoints this replica is clean on; the server takes them over at the anchor. */
        clean: string[];
    }
): Promise<string> {
    const response = await post(serverUrl, '/api/sync/bootstrap', {
        ...syncScope.scope,
        ...request
    });
    if (typeof response.token !== 'string' || !response.token) {
        throw new AppError('NETWORK_ERROR', 'Sync server returned an invalid bootstrap');
    }
    return response.token;
}

/** The server's lineage, its forgotten-deletion watermark, and checkpoints that cover it. */
export async function adoptServerScope(
    syncScope: SyncScope,
    serverUrl: string
): Promise<{ lineage: string; gcHigh: number; checkpoints: string[] }> {
    const response = await post(serverUrl, '/api/sync/adopt', { ...syncScope.scope });
    const lineage = readLineage(response.lineage);
    if (!lineage) throw new AppError('NETWORK_ERROR', 'Sync server returned no lineage');
    return {
        lineage,
        gcHigh: readNumber(response.gcHigh),
        checkpoints: readIds(response.checkpoints)
    };
}

/**
 * Confirm the Pull at the session boundary and exchange checkpoints.
 *
 * The server re-checks its GC watermark against the coverage the session started with, so a
 * GC that raced the Pull fails the commit instead of advancing the Pull cursor over deletions
 * this client never received. A checkpoint is issued only after a complete Push.
 */
export async function commitSyncSession(
    syncScope: SyncScope,
    serverUrl: string,
    session: SyncSession,
    bounds: SessionBounds
): Promise<void> {
    const { scope } = syncScope;
    const { cursors, serverUpper, localUpper, pushed } = bounds;
    const inherit = pushed
        ? session.checkpoints
              .filter(({ heldAt }) => heldAt > cursors.localPushCursor && heldAt <= localUpper)
              .map(({ id }) => id)
        : [];
    const issued = pushed && needsCheckpoint(session, cursors) ? crypto.randomUUID() : undefined;

    const response = await post(serverUrl, '/api/sync/commit', {
        ...scope,
        pullCursor: cursors.serverPullCursor,
        serverUpper,
        checkpoints: session.checkpoints.map(({ id }) => id),
        inherit,
        checkpoint: issued,
        lineage: session.lineage,
        bootstrapToken: session.bootstrapToken,
        adoptedGcHigh: session.adoptedGcHigh,
        pushed
    });

    await localDB.addSyncCheckpoints(scope, [
        ...readIds(response.checkpoints).map((id) => ({ id, anchor: 0 })),
        ...(issued ? [{ id: issued, anchor: localUpper }] : [])
    ]);
}

/** GC only tombstones already pushed to the session server, then expire old checkpoints. */
export async function collectGarbage(scope: DataScope, pushedThrough: number): Promise<void> {
    const now = Date.now();
    await localDB.collectTombstones(scope, {
        receivedThrough: now - TOMBSTONE_RETENTION_MS,
        throughLocalUpdatedAt: pushedThrough
    });
    await localDB.pruneSyncCheckpoints(scope, now - CHECKPOINT_RETENTION_MS);
}

/** A live record unknown to this replica may be a deletion it forgot; refuse it unless covered. */
export function assertIngestCovered(scope: DataScope, gcHigh: number, localCoverage: number): void {
    if (gcHigh > localCoverage) {
        throw new AppError('SYNC_UNSAFE', `Merge of ${scopeLabel(scope)} is no longer covered`);
    }
}

/** Failures that stop a scope until a full session verifies it again. */
export function isSafetyError(error: unknown): boolean {
    return isErrorCode(error, 'SYNC_UNSAFE') || isErrorCode(error, 'SYNC_NEEDS_INIT');
}

/**
 * Server refusals: an unproven merge, a replaced lineage, or a scope changed under a
 * resolution are unsafe merges; a scope another client is initializing is transient.
 */
export function toSyncSafetyError(error: unknown): unknown {
    const response =
        error && typeof error === 'object'
            ? ((error as { response?: unknown; data?: unknown }).response ??
              (error as { data?: unknown }).data)
            : undefined;
    const text = response === undefined ? '' : JSON.stringify(response);
    if (/sync_initializing/i.test(text)) {
        return new AppError('SYNC_INITIALIZING', 'Sync server scope is being initialized', error);
    }
    if (/sync_(unsafe|lineage|conflict)/i.test(text)) {
        return new AppError('SYNC_UNSAFE', 'Server refused an unproven merge', error);
    }
    return error;
}

function needsCheckpoint(session: SyncSession, cursors: SyncCursorState): boolean {
    if (cursors.serverPullCursor === 0 && cursors.localPushCursor === 0) return true;
    const recent = Date.now() - CHECKPOINT_INTERVAL_MS;
    return !session.checkpoints.some(({ anchor, createdAt }) => anchor > 0 && createdAt > recent);
}

/**
 * Dropping an offered checkpoint only weakens proofs. Own anchored checkpoints prove this
 * replica's forgotten deletions, so they go first; newer inherited ones follow.
 */
function offeredCheckpoints(checkpoints: SyncCheckpoint[]): SyncCheckpoint[] {
    return [...checkpoints]
        .sort((a, b) => Number(b.anchor > 0) - Number(a.anchor > 0) || b.heldAt - a.heldAt)
        .slice(0, MAX_OFFERED_CHECKPOINTS);
}

async function post(
    serverUrl: string,
    path: string,
    body: Record<string, unknown>
): Promise<Record<string, unknown>> {
    try {
        assertSyncServer(serverUrl);
        const response = (await pb.send(path, {
            method: 'POST',
            body,
            requestKey: null
        })) as unknown;
        if (!response || typeof response !== 'object') {
            throw new AppError('NETWORK_ERROR', `Invalid ${path} response`);
        }
        return response as Record<string, unknown>;
    } catch (error) {
        throw toSyncSafetyError(error);
    }
}

function readNumber(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new AppError('NETWORK_ERROR', 'Sync server returned an invalid safety state');
    }
    return value;
}

function readLineage(value: unknown): string | null {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value !== 'string') {
        throw new AppError('NETWORK_ERROR', 'Sync server returned an invalid lineage');
    }
    return value;
}

function readInitializing(value: unknown): 'active' | 'stale' | null {
    return value === 'active' || value === 'stale' ? value : null;
}

function readIds(value: unknown): string[] {
    if (!Array.isArray(value) || value.some((id) => typeof id !== 'string')) {
        throw new AppError('NETWORK_ERROR', 'Sync server returned invalid checkpoints');
    }
    return value as string[];
}

function scopeLabel(scope: DataScope): string {
    return `${scope.scopeType} scope ${scope.scopeId}`;
}
