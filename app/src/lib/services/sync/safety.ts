/**
 * Merge safety for tombstone GC.
 *
 * A replica that garbage-collects a tombstone forgets that deletion. Merging with a replica
 * that still holds the record live would silently resurrect it, so every scope session first
 * proves, in both directions, that the peer knows every deletion this side has forgotten.
 * The proof is the direct relationship cursor or a shared History–Clean checkpoint.
 * The invariants and their argument are documented in docs/sync-gc.md.
 */

import { pb } from '$lib/adapters/pb';
import { localDB, type DataScope, type SyncCheckpoint } from '$lib/adapters/db';
import type { SyncCursorState } from '$lib/adapters/sync';
import { AppError } from '$lib/types/errors';
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

export type MergeSafety = 'safe' | 'unsafe' | 'needs_init';

export interface ReplicaSafety {
    /** Highest own position of a forgotten deletion. */
    gcHigh: number;
    /** Highest own position whose forgotten deletions the peer provably knows. */
    coverage: number;
    /** Whether this replica has ever recorded safety state for the scope. */
    initialized: boolean;
}

export interface SyncSession {
    /** This client's forgotten deletions known by the server, in local revisions. */
    localCoverage: number;
    /** The server's forgotten deletions known by this client, in server positions. */
    serverCoverage: number;
    /** Checkpoints this client offered when the session opened. */
    checkpoints: SyncCheckpoint[];
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

export function classifyMerge(local: ReplicaSafety, remote: ReplicaSafety): MergeSafety {
    const localCovered = local.gcHigh <= local.coverage;
    const remoteCovered = remote.gcHigh <= remote.coverage;
    if (localCovered && remoteCovered) return 'safe';
    if ((!localCovered && !remote.initialized) || (!remoteCovered && !local.initialized)) {
        return 'needs_init';
    }
    return 'unsafe';
}

/** Prove both merge directions before any Pull or Push of the scope starts. */
export async function openSyncSession(
    syncScope: SyncScope,
    serverUrl: string,
    cursors: SyncCursorState
): Promise<SyncSession> {
    const { scope } = syncScope;
    const [gcHigh, held] = await Promise.all([
        localDB.getSyncGcHigh(scope),
        localDB.getSyncCheckpoints(scope)
    ]);
    const checkpoints = offeredCheckpoints(held);
    const response = await post(serverUrl, '/api/sync/handshake', {
        ...scope,
        pullCursor: cursors.serverPullCursor,
        checkpoints: checkpoints.map(({ id }) => id)
    });
    const remoteGcHigh = readNumber(response.gcHigh);
    const serverCoverage = readNumber(response.coverage);
    const known = new Set(readIds(response.known));
    const localCoverage = coverage(cursors.localPushCursor, checkpoints, known);

    const safety = classifyMerge(
        { gcHigh, coverage: localCoverage, initialized: gcHigh > 0 || checkpoints.length > 0 },
        {
            gcHigh: remoteGcHigh,
            coverage: serverCoverage,
            initialized: response.initialized === true
        }
    );
    if (safety === 'unsafe') {
        throw new AppError('SYNC_UNSAFE', `Merge of ${scopeLabel(scope)} cannot be proven safe`);
    }
    if (safety === 'needs_init') {
        throw new AppError('SYNC_NEEDS_INIT', `${scopeLabel(scope)} requires initialization`);
    }
    return { localCoverage, serverCoverage, checkpoints };
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
        checkpoint: issued
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

/** Server rejections of unproven creates are reported as unsafe merges. */
export function toSyncSafetyError(error: unknown): unknown {
    const response =
        error && typeof error === 'object'
            ? ((error as { response?: unknown; data?: unknown }).response ??
              (error as { data?: unknown }).data)
            : undefined;
    if (response !== undefined && /sync_unsafe/i.test(JSON.stringify(response))) {
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

function readIds(value: unknown): string[] {
    if (!Array.isArray(value) || value.some((id) => typeof id !== 'string')) {
        throw new AppError('NETWORK_ERROR', 'Sync server returned invalid checkpoints');
    }
    return value as string[];
}

function scopeLabel(scope: DataScope): string {
    return `${scope.scopeType} scope ${scope.scopeId}`;
}
