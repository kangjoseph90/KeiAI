/**
 * Tombstone GC merge-safety protocol (docs/sync-gc.md).
 *
 * Replicas here are in-memory models of the orchestration in services/sync/data.ts and the
 * PocketBase hooks. Every safety decision goes through the production rules: the client's
 * `coverage`/`mergeCovered` and the server's `syncCoverage` from pb_hooks/keiai.js.
 * Oracle: a replica that ever held a deletion never holds that record live again.
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { coverage, mergeCovered, type ReplicaSafety } from '$lib/services/sync/safety';

const require = createRequire(import.meta.url);
const server = require('../../../../pocketbase/pb_hooks/keiai.js') as {
    syncCoverage(cursor: number, anchors: number[]): number;
};

type MergeSafety = 'safe' | 'unsafe' | 'needs_init';

/**
 * History–Clean only: this model has a single lineage and no adoption, so a replica that
 * never recorded safety state is reported instead of being initialized.
 */
function classifyMerge(
    local: ReplicaSafety & { initialized: boolean },
    remote: ReplicaSafety & { initialized: boolean }
): MergeSafety {
    if (mergeCovered(local, remote)) return 'safe';
    const localCovered = local.gcHigh <= local.coverage;
    const remoteCovered = remote.gcHigh <= remote.coverage;
    if ((!localCovered && !remote.initialized) || (!remoteCovered && !local.initialized)) {
        return 'needs_init';
    }
    return 'unsafe';
}

const RETENTION = 30;
const CHECKPOINT_INTERVAL = 1;

interface Row {
    deleted: boolean;
    version: number;
    pos: number;
    tombAt?: number;
}

interface Checkpoint {
    anchor: number;
    heldAt: number;
    createdAt: number;
}

class Replica {
    rev = 0;
    gcHigh = 0;
    readonly rows = new Map<string, Row>();
    readonly checkpoints = new Map<string, Checkpoint>();
    /** Ground truth for the oracle: deletions this replica has ever held. */
    readonly knewDeleted = new Set<string>();

    constructor(readonly name: string) {}

    /** Persist a canonical change; duplicates keep their position and receipt time. */
    write(id: string, state: { deleted: boolean; version: number }, now: number): void {
        const before = this.rows.get(id);
        if (before && before.deleted === state.deleted && before.version === state.version) return;
        this.rows.set(id, {
            ...state,
            pos: ++this.rev,
            tombAt: state.deleted ? (before?.deleted ? before.tombAt : now) : undefined
        });
        if (state.deleted) this.knewDeleted.add(id);
    }

    addCheckpoints(entries: Array<[string, number]>, now: number): void {
        const added = entries.filter(([id]) => !this.checkpoints.has(id));
        if (added.length === 0) return;
        const heldAt = ++this.rev;
        for (const [id, anchor] of added)
            this.checkpoints.set(id, { anchor, heldAt, createdAt: now });
    }

    /** Raise the watermark over every removed tombstone before forgetting it. */
    collect(receivedThrough: number, throughPos: number): void {
        const doomed = [...this.rows].filter(
            ([, row]) => row.deleted && row.tombAt! <= receivedThrough && row.pos <= throughPos
        );
        this.gcHigh = Math.max(this.gcHigh, ...doomed.map(([, row]) => row.pos));
        for (const [id] of doomed) this.rows.delete(id);
    }

    liveIds(): string[] {
        return [...this.rows].filter(([, row]) => !row.deleted).map(([id]) => id);
    }
}

class Server extends Replica {
    /** Server create guard: a live create must cover this server's forgotten deletions. */
    accept(
        id: string,
        incoming: { deleted: boolean; version: number },
        coverageHeader: number,
        now: number
    ): void {
        const original = this.rows.get(id);
        if (!original) {
            if (!incoming.deleted && this.gcHigh > coverageHeader) throw new Unsafe('server guard');
            this.write(id, incoming, now);
            return;
        }
        const accepted =
            (!original.deleted && incoming.deleted) ||
            (incoming.deleted === original.deleted && incoming.version > original.version);
        if (accepted) this.write(id, incoming, now);
    }
}

class Client extends Replica {
    readonly cursors = new Map<string, { pull: number; push: number }>();
    cursor(server: Server) {
        return this.cursors.get(server.name) ?? { pull: 0, push: 0 };
    }
}

class Unsafe extends Error {}

type Interrupt = 'afterPull' | 'afterPush' | 'commitLost' | 'beforeStore' | undefined;

interface World {
    now: number;
    version: number;
}

/** One verified session; mirrors DataRecordSyncEngine.syncScope. */
function sync(world: World, client: Client, srv: Server, interrupt?: Interrupt): MergeSafety {
    const { now } = world;
    const cursors = client.cursor(srv);
    const sessionCheckpoints = new Map(client.checkpoints);

    // Handshake.
    const ids = [...sessionCheckpoints.keys()];
    const held = ids.filter((id) => srv.checkpoints.has(id));
    const serverCoverage = server.syncCoverage(
        cursors.pull,
        held.map((id) => srv.checkpoints.get(id)!.anchor)
    );
    const localCoverage = coverage(
        cursors.push,
        [...sessionCheckpoints].map(([id, { anchor }]) => ({ id, anchor })),
        new Set(held)
    );
    const safety = classifyMerge(
        {
            gcHigh: client.gcHigh,
            coverage: localCoverage,
            initialized: client.gcHigh > 0 || sessionCheckpoints.size > 0
        },
        {
            gcHigh: srv.gcHigh,
            coverage: serverCoverage,
            initialized: srv.gcHigh > 0 || srv.checkpoints.size > 0
        }
    );
    if (safety !== 'safe') return safety;

    const serverUpper = srv.rev;
    const localUpper = client.rev;

    // Pull with the per-page ingest guard.
    const pullRange = (after: number, through: number, corrections: Set<string>) => {
        for (const [id, remote] of srv.rows) {
            if (remote.pos <= after || remote.pos > through) continue;
            const local = client.rows.get(id);
            if (!local) {
                if (!remote.deleted && client.gcHigh > localCoverage)
                    throw new Error('ingest guard');
                client.write(id, remote, now);
            } else if (remote.deleted && !local.deleted) client.write(id, remote, now);
            else if (local.deleted && !remote.deleted) corrections.add(id);
            else if (remote.version > local.version) client.write(id, remote, now);
            else if (remote.version < local.version) corrections.add(id);
        }
    };
    const corrections = new Set<string>();
    pullRange(cursors.pull, serverUpper, corrections);
    if (interrupt === 'afterPull') return 'safe';

    // Push; the server applies each create under its guard.
    const pushIds = new Set(corrections);
    for (const [id, row] of client.rows) {
        if (row.pos > cursors.push && row.pos <= localUpper) pushIds.add(id);
    }
    let pushed = true;
    try {
        for (const id of pushIds) {
            const row = client.rows.get(id)!;
            srv.accept(id, row, serverCoverage, now);
            const canonical = srv.rows.get(id)!;
            const local = client.rows.get(id)!;
            if (
                (canonical.deleted && !local.deleted) ||
                (canonical.deleted === local.deleted && canonical.version > local.version)
            ) {
                client.write(id, canonical, now);
            }
        }
    } catch (error) {
        if (!(error instanceof Unsafe)) throw error;
        pushed = false;
    }
    if (interrupt === 'afterPush') return 'safe';

    // Pull own pushes back so the confirmed range covers them.
    let pulledThrough = serverUpper;
    if (pushed && pushIds.size > 0) {
        const confirmUpper = srv.rev;
        const followUp = new Set<string>();
        pullRange(serverUpper, confirmUpper, followUp);
        if (followUp.size === 0) pulledThrough = confirmUpper;
    }

    // Commit: server end-check, issuance, and inheritance in one transaction.
    let pulled = true;
    const commitCoverage = server.syncCoverage(
        cursors.pull,
        ids.filter((id) => srv.checkpoints.has(id)).map((id) => srv.checkpoints.get(id)!.anchor)
    );
    if (srv.gcHigh > commitCoverage) {
        pulled = false;
    } else {
        const recent = [...sessionCheckpoints.values()].some(
            ({ anchor, createdAt }) => anchor > 0 && createdAt > now - CHECKPOINT_INTERVAL
        );
        const issue =
            pushed && ((cursors.pull === 0 && cursors.push === 0) || !recent)
                ? `K${++world.version}`
                : undefined;
        const heldAt = ++srv.rev;
        if (issue) srv.checkpoints.set(issue, { anchor: pulledThrough, heldAt, createdAt: now });
        if (pushed) {
            for (const [id, { heldAt: at }] of sessionCheckpoints) {
                if (at > cursors.push && at <= localUpper && !srv.checkpoints.has(id)) {
                    srv.checkpoints.set(id, { anchor: 0, heldAt, createdAt: now });
                }
            }
        }
        const inherited = [...srv.checkpoints]
            .filter(([, { heldAt: at }]) => at > cursors.pull && at <= pulledThrough)
            .map(([id]): [string, number] => [id, 0]);
        if (interrupt === 'commitLost') return 'safe';
        client.addCheckpoints(
            [...inherited, ...(issue ? [[issue, localUpper] as [string, number]] : [])],
            now
        );
    }
    if (interrupt === 'beforeStore') return 'safe';

    client.cursors.set(srv.name, {
        pull: pulled ? Math.max(cursors.pull, pulledThrough) : cursors.pull,
        push: pushed ? Math.max(cursors.push, localUpper) : cursors.push
    });
    if (pushed) client.collect(now - RETENTION, client.cursor(srv).push);
    if (!pulled) return 'unsafe';
    return pushed ? 'safe' : 'unsafe';
}

function serverGc(world: World, srv: Server): void {
    srv.collect(world.now - RETENTION, Number.POSITIVE_INFINITY);
}

function create(world: World, replica: Client, id: string): void {
    replica.write(id, { deleted: false, version: ++world.version }, world.now);
}

function remove(world: World, replica: Client, id: string): void {
    replica.write(id, { deleted: true, version: ++world.version }, world.now);
}

function assertNoResurrection(replicas: Replica[]): void {
    for (const replica of replicas) {
        for (const id of replica.liveIds()) {
            expect(replica.knewDeleted.has(id), `${id} resurrected on ${replica.name}`).toBe(false);
        }
    }
}

function setup(clients: string[], servers: string[]) {
    const world: World = { now: 0, version: 0 };
    return {
        world,
        c: Object.fromEntries(clients.map((n) => [n, new Client(n)])),
        s: Object.fromEntries(servers.map((n) => [n, new Server(n)]))
    };
}

describe('merge safety rules', () => {
    it('raises coverage only through checkpoints the peer holds', () => {
        const checkpoints = [
            { id: 'a', anchor: 50 },
            { id: 'b', anchor: 90 }
        ];
        expect(coverage(10, checkpoints, new Set(['a']))).toBe(50);
        expect(coverage(70, checkpoints, new Set(['a']))).toBe(70);
        expect(coverage(10, checkpoints, new Set())).toBe(10);
        expect(server.syncCoverage(10, [50, 90])).toBe(90);
    });

    it('separates safe, unsafe, and initialization outcomes', () => {
        const covered = { gcHigh: 5, coverage: 5, initialized: true };
        const uncovered = { gcHigh: 6, coverage: 5, initialized: true };
        const fresh = { gcHigh: 0, coverage: 0, initialized: false };
        expect(classifyMerge(covered, covered)).toBe('safe');
        expect(classifyMerge(fresh, fresh)).toBe('safe');
        expect(classifyMerge(uncovered, covered)).toBe('unsafe');
        expect(classifyMerge(covered, uncovered)).toBe('unsafe');
        expect(classifyMerge(uncovered, fresh)).toBe('needs_init');
        expect(classifyMerge(fresh, uncovered)).toBe('needs_init');
    });
});

describe('tombstone GC protocol scenarios', () => {
    it('1. syncs normally across devices and servers', () => {
        const { world, c, s } = setup(['A', 'B'], ['V1', 'V2']);
        create(world, c.A, 'x');
        expect(sync(world, c.A, s.V1)).toBe('safe');
        expect(sync(world, c.B, s.V1)).toBe('safe');
        remove(world, c.B, 'x');
        create(world, c.B, 'y');
        expect(sync(world, c.B, s.V1)).toBe('safe');
        expect(sync(world, c.A, s.V1)).toBe('safe');
        expect(sync(world, c.A, s.V2)).toBe('safe');
        expect(c.A.liveIds()).toEqual(['y']);
        expect(s.V2.liveIds()).toEqual(['y']);
        assertNoResurrection([c.A, c.B, s.V1, s.V2]);
    });

    it('2. resyncs after the receiver collected the tombstone', () => {
        const { world, c, s } = setup(['A', 'B'], ['V']);
        create(world, c.A, 'x');
        sync(world, c.A, s.V);
        sync(world, c.B, s.V);
        remove(world, c.A, 'x');
        sync(world, c.A, s.V);
        sync(world, c.B, s.V);
        world.now = 40;
        expect(sync(world, c.B, s.V)).toBe('safe');
        expect(c.B.gcHigh).toBeGreaterThan(0);
        expect(c.B.rows.has('x')).toBe(false);
        serverGc(world, s.V);
        expect(s.V.rows.has('x')).toBe(false);
        expect(sync(world, c.B, s.V)).toBe('safe');
        expect(sync(world, c.A, s.V)).toBe('safe');
        assertNoResurrection([c.A, c.B, s.V]);
    });

    it('3. refuses a stale replica that never saw the collected deletion', () => {
        const { world, c, s } = setup(['A', 'Stale'], ['V']);
        create(world, c.A, 'x');
        sync(world, c.A, s.V);
        sync(world, c.Stale, s.V);
        remove(world, c.A, 'x');
        sync(world, c.A, s.V);
        world.now = 40;
        serverGc(world, s.V);
        create(world, c.Stale, 'new');
        expect(sync(world, c.Stale, s.V)).toBe('unsafe');
        expect(s.V.rows.has('x')).toBe(false);
        expect(s.V.rows.has('new')).toBe(false);
        assertNoResurrection([c.A, c.Stale, s.V]);
    });

    it.each([
        ['B synced last on the old server', ['A', 'B']],
        ['A synced last on the old server', ['B', 'A']]
    ])('4. merges a device into a new server without direct cursors (%s)', (_name, order) => {
        const { world, c, s } = setup(['A', 'B'], ['V1', 'V2']);
        // B has collected a deletion; A never collected anything.
        create(world, c.B, 'old');
        sync(world, c.B, s.V1);
        remove(world, c.B, 'old');
        sync(world, c.B, s.V1);
        world.now = 40;
        sync(world, c.B, s.V1);
        expect(c.B.gcHigh).toBeGreaterThan(0);
        world.now = 41;
        create(world, c.A, 'a');
        create(world, c.B, 'b');
        for (const name of order) expect(sync(world, c[name], s.V1)).toBe('safe');

        expect(sync(world, c.A, s.V2)).toBe('safe');
        expect(c.B.cursor(s.V2)).toEqual({ pull: 0, push: 0 });
        expect(sync(world, c.B, s.V2)).toBe('safe');
        expect(sync(world, c.A, s.V2)).toBe('safe');
        expect(c.A.liveIds().sort()).toEqual(['a', 'b']);
        expect(c.B.liveIds().sort()).toEqual(['a', 'b']);
        assertNoResurrection([c.A, c.B, s.V1, s.V2]);
    });

    it('5. refuses when a common history exists but only one side collected an unknown deletion', () => {
        const { world, c, s } = setup(['A', 'B'], ['V1', 'V2']);
        create(world, c.A, 'x');
        sync(world, c.A, s.V1);
        sync(world, c.B, s.V1);
        sync(world, c.A, s.V1);
        // A deletes x and collects it on V1; B never learns of it and moves to V2.
        remove(world, c.A, 'x');
        sync(world, c.A, s.V1);
        expect(sync(world, c.B, s.V2)).toBe('safe');
        world.now = 40;
        sync(world, c.A, s.V1);
        expect(c.A.rows.has('x')).toBe(false);
        expect(sync(world, c.A, s.V2)).toBe('unsafe');
        expect(c.A.rows.has('x')).toBe(false);
        assertNoResurrection([c.A, c.B, s.V1, s.V2]);
    });

    it('6. handles independent GC on different servers', () => {
        const { world, c, s } = setup(['A', 'B'], ['V1', 'V2']);
        create(world, c.A, 'x');
        create(world, c.A, 'y');
        sync(world, c.A, s.V1);
        sync(world, c.A, s.V2);
        sync(world, c.B, s.V1);
        sync(world, c.B, s.V2);
        remove(world, c.A, 'x');
        sync(world, c.A, s.V1);
        remove(world, c.B, 'y');
        sync(world, c.B, s.V2);
        world.now = 40;
        serverGc(world, s.V1);
        serverGc(world, s.V2);
        // Each client knows only one deletion; neither server proves the other's.
        expect(sync(world, c.A, s.V2)).toBe('unsafe');
        expect(sync(world, c.B, s.V1)).toBe('unsafe');
        // Each still syncs with its own server.
        expect(sync(world, c.A, s.V1)).toBe('safe');
        expect(sync(world, c.B, s.V2)).toBe('safe');
        assertNoResurrection([c.A, c.B, s.V1, s.V2]);
    });

    it('7. accepts a long-offline replica only when nothing it missed was collected', () => {
        const { world, c, s } = setup(['A', 'Offline'], ['V']);
        create(world, c.A, 'x');
        sync(world, c.A, s.V);
        sync(world, c.Offline, s.V);
        remove(world, c.Offline, 'mine');
        create(world, c.Offline, 'offline-edit');
        world.now = 200;
        create(world, c.A, 'later');
        sync(world, c.A, s.V);
        serverGc(world, s.V);
        expect(sync(world, c.Offline, s.V)).toBe('safe');
        expect(c.Offline.liveIds().sort()).toEqual(['later', 'offline-edit', 'x']);

        remove(world, c.A, 'x');
        sync(world, c.A, s.V);
        const late = new Client('Late');
        sync(world, late, s.V);
        world.now = 400;
        serverGc(world, s.V);
        sync(world, c.A, s.V);
        expect(sync(world, c.Offline, s.V)).toBe('unsafe');
        expect(c.Offline.rows.get('x')?.deleted).toBe(false);
        assertNoResurrection([c.A, c.Offline, s.V]);
    });

    it.each(['afterPull', 'afterPush', 'commitLost', 'beforeStore'] as const)(
        '8. keeps proofs sound when a session is interrupted (%s)',
        (interrupt) => {
            const { world, c, s } = setup(['A', 'B'], ['V1', 'V2']);
            create(world, c.B, 'old');
            sync(world, c.B, s.V1);
            remove(world, c.B, 'old');
            sync(world, c.B, s.V1);
            world.now = 40;
            sync(world, c.B, s.V1);
            sync(world, c.A, s.V1, interrupt);
            sync(world, c.A, s.V2);
            // Whether or not A carried B's checkpoint, nothing unproven merges.
            const result = sync(world, c.B, s.V2);
            expect(['safe', 'unsafe']).toContain(result);
            if (interrupt === 'beforeStore' || interrupt === 'commitLost') {
                expect(c.A.cursor(s.V1)).toEqual({ pull: 0, push: 0 });
            }
            sync(world, c.A, s.V1);
            sync(world, c.A, s.V2);
            expect(sync(world, c.B, s.V2)).toBe('safe');
            assertNoResurrection([c.A, c.B, s.V1, s.V2]);
        }
    );

    it('9. fails the commit when server GC races the Pull, without advancing the Pull cursor', () => {
        const { world, c, s } = setup(['A', 'B'], ['V']);
        create(world, c.A, 'x');
        sync(world, c.A, s.V);
        remove(world, c.A, 'x');
        sync(world, c.A, s.V);
        world.now = 40;
        // B's session passes the handshake, then GC collects x before B reads it.
        const srv = s.V;
        const original = srv.rows.get.bind(srv.rows);
        let raced = false;
        srv.rows.get = (id: string) => {
            if (!raced) {
                raced = true;
                serverGc(world, srv);
            }
            return original(id);
        };
        const iterate = srv.rows[Symbol.iterator].bind(srv.rows);
        srv.rows[Symbol.iterator] = () => {
            if (!raced) {
                raced = true;
                serverGc(world, srv);
            }
            return iterate();
        };
        expect(sync(world, c.B, srv)).toBe('unsafe');
        expect(c.B.cursor(srv).pull).toBe(0);
        // B never learned x, so the next handshake refuses instead of trusting the cursor.
        expect(sync(world, c.B, srv)).toBe('needs_init');
        assertNoResurrection([c.A, c.B, srv]);
    });

    it('10. keeps safety state through duplicate receives and restart', () => {
        const { world, c, s } = setup(['A'], ['V']);
        create(world, c.A, 'x');
        sync(world, c.A, s.V);
        remove(world, c.A, 'x');
        sync(world, c.A, s.V);
        const receivedAt = c.A.rows.get('x')!.tombAt;
        world.now = 20;
        sync(world, c.A, s.V);
        sync(world, c.A, s.V);
        expect(c.A.rows.get('x')!.tombAt).toBe(receivedAt);
        world.now = 31;
        sync(world, c.A, s.V);
        expect(c.A.rows.has('x')).toBe(false);
        const restarted = Object.assign(new Client('A'), structuredClone(c.A));
        expect(sync(world, restarted, s.V)).toBe('safe');
        assertNoResurrection([restarted, s.V]);
    });
});

describe('randomized resurrection search', () => {
    it('never resurrects a known deletion across random histories', { timeout: 30_000 }, () => {
        let seed = 12345;
        const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
        const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)];
        let blocked = 0;
        let merged = 0;

        for (let run = 0; run < 300; run++) {
            const world: World = { now: 0, version: 0 };
            const clients = [new Client('A'), new Client('B'), new Client('C')];
            const servers = [new Server('V1'), new Server('V2'), new Server('V3')];
            let nextId = 0;
            for (let step = 0; step < 80; step++) {
                const client = pick(clients);
                const roll = random();
                if (roll < 0.2) create(world, client, `r${nextId++}`);
                else if (roll < 0.35) {
                    const live = client.liveIds();
                    if (live.length > 0) remove(world, client, pick(live));
                } else if (roll < 0.8) {
                    const result = sync(
                        world,
                        client,
                        pick(servers),
                        random() < 0.1
                            ? pick(['afterPull', 'afterPush', 'commitLost', 'beforeStore'] as const)
                            : undefined
                    );
                    if (result === 'safe') merged++;
                    else blocked++;
                } else if (roll < 0.9) serverGc(world, pick(servers));
                else world.now += Math.floor(random() * 25);
                assertNoResurrection([...clients, ...servers]);
            }
        }
        expect(merged).toBeGreaterThan(blocked);
    });
});
