/**
 * Bootstrap, adoption and overwrite on top of tombstone GC (docs/sync-gc.md).
 *
 * In-memory replicas model data.ts and the PocketBase hooks; every decision goes through the
 * production `planSession`/`coverage` and the server's `syncCoverage`. Two oracles hold after
 * every step:
 * - a replica never holds live a record whose deletion it knew, where adoption or overwrite
 *   starts a new incarnation that knows what its source knew;
 * - a replica of lineage L only holds records that belong to L: an overwrite discards the
 *   records it replaced, and no merge may bring them back.
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { coverage, planSession, type SessionPlan } from '$lib/services/sync/safety';

const require = createRequire(import.meta.url);
const hooks = require('../../../../pocketbase/pb_hooks/keiai.js') as {
    syncCoverage(cursor: number, anchors: number[]): number;
};

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
    lineage: string | null = null;
    rows = new Map<string, Row>();
    checkpoints = new Map<string, Checkpoint>();
    knewDeleted = new Set<string>();

    constructor(readonly name: string) {}

    write(id: string, state: { deleted: boolean; version: number }, now: number): void {
        const before = this.rows.get(id);
        if (before && before.deleted === state.deleted && before.version === state.version) return;
        this.rows.set(id, {
            ...state,
            pos: ++this.rev,
            tombAt: state.deleted
                ? before?.deleted && before.version === state.version
                    ? before.tombAt
                    : now
                : undefined
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

class Unsafe extends Error {}

class Server extends Replica {
    accept(
        id: string,
        incoming: { deleted: boolean; version: number },
        proof: { coverage: number; lineage: string },
        now: number
    ): void {
        if (proof.lineage !== this.lineage) throw new Unsafe('lineage');
        const original = this.rows.get(id);
        if (!original) {
            if (!incoming.deleted && this.gcHigh > proof.coverage) throw new Unsafe('guard');
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
    cursors = new Map<string, { pull: number; push: number }>();
    cursor(srv: Server) {
        return this.cursors.get(srv.name) ?? { pull: 0, push: 0 };
    }
}

interface World {
    now: number;
    version: number;
    lineages: number;
    /** Records that belong to each lineage. */
    members: Map<string, Set<string>>;
}

function member(world: World, lineage: string | null, id: string): void {
    if (!lineage) return;
    const ids = world.members.get(lineage) ?? new Set<string>();
    ids.add(id);
    world.members.set(lineage, ids);
}

function newLineage(world: World, ids: Iterable<string>): string {
    const lineage = `L${++world.lineages}`;
    world.members.set(lineage, new Set(ids));
    return lineage;
}

/** A verified session; mirrors runSession with the server's checks. */
function session(
    world: World,
    client: Client,
    srv: Server,
    context: { adoptedGcHigh?: number } = {}
): boolean {
    const { now } = world;
    const cursors = client.cursor(srv);
    const offered = new Map(client.checkpoints);
    const ids = [...offered.keys()];
    const held = ids.filter((id) => srv.checkpoints.has(id));
    const serverCoverage = hooks.syncCoverage(
        cursors.pull,
        held.map((id) => srv.checkpoints.get(id)!.anchor)
    );
    const localCoverage = coverage(
        cursors.push,
        [...offered].map(([id, { anchor }]) => ({ id, anchor })),
        new Set(held)
    );
    if (client.gcHigh > localCoverage || srv.gcHigh > serverCoverage) return false;
    const lineage = client.lineage!;
    const serverUpper = srv.rev;
    const localUpper = client.rev;

    const corrections = new Set<string>();
    const pullRange = (after: number, through: number, into: Set<string>) => {
        for (const [id, remote] of srv.rows) {
            if (remote.pos <= after || remote.pos > through) continue;
            const local = client.rows.get(id);
            if (!local) {
                if (!remote.deleted && client.gcHigh > localCoverage)
                    throw new Error('ingest guard');
                client.write(id, remote, now);
            } else if (remote.deleted && !local.deleted) client.write(id, remote, now);
            else if (local.deleted && !remote.deleted) into.add(id);
            else if (remote.version > local.version) client.write(id, remote, now);
            else if (remote.version < local.version) into.add(id);
        }
    };
    pullRange(cursors.pull, serverUpper, corrections);

    const pushIds = new Set(corrections);
    for (const [id, row] of client.rows) {
        if (row.pos > cursors.push && row.pos <= localUpper) pushIds.add(id);
    }
    for (const id of pushIds) {
        srv.accept(id, client.rows.get(id)!, { coverage: serverCoverage, lineage }, now);
        const canonical = srv.rows.get(id)!;
        const local = client.rows.get(id)!;
        if (
            (canonical.deleted && !local.deleted) ||
            (canonical.deleted === local.deleted && canonical.version > local.version)
        ) {
            client.write(id, canonical, now);
        }
    }
    let pulledThrough = serverUpper;
    if (pushIds.size > 0) {
        const confirmUpper = srv.rev;
        const followUp = new Set<string>();
        pullRange(serverUpper, confirmUpper, followUp);
        if (followUp.size === 0) pulledThrough = confirmUpper;
    }

    // Commit: lineage, end-check and the adoption watermark, then issuance and inheritance.
    if (srv.lineage !== lineage) return false;
    if (srv.gcHigh > serverCoverage) return false;
    if (context.adoptedGcHigh !== undefined && srv.gcHigh > context.adoptedGcHigh) return false;
    const recent = [...offered.values()].some(
        ({ anchor, createdAt }) => anchor > 0 && createdAt > now - CHECKPOINT_INTERVAL
    );
    const issue =
        (cursors.pull === 0 && cursors.push === 0) || !recent ? `K${++world.version}` : undefined;
    const heldAt = ++srv.rev;
    if (issue) srv.checkpoints.set(issue, { anchor: pulledThrough, heldAt, createdAt: now });
    for (const [id, { heldAt: at }] of offered) {
        if (at > cursors.push && at <= localUpper && !srv.checkpoints.has(id)) {
            srv.checkpoints.set(id, { anchor: 0, heldAt, createdAt: now });
        }
    }
    const inherited = [...srv.checkpoints]
        .filter(([, { heldAt: at }]) => at > cursors.pull && at <= pulledThrough)
        .map(([id]): [string, number] => [id, 0]);
    client.addCheckpoints(
        [...inherited, ...(issue ? [[issue, localUpper] as [string, number]] : [])],
        now
    );
    client.cursors.set(srv.name, {
        pull: Math.max(cursors.pull, pulledThrough),
        push: Math.max(cursors.push, localUpper)
    });
    client.collect(now - RETENTION, client.cursor(srv).push);
    return true;
}

/** The client replaces its replica with the server's; see DataRecordSyncEngine.adoptScope. */
function adopt(world: World, client: Client, srv: Server): boolean {
    client.rows = new Map();
    client.checkpoints = new Map();
    client.cursors = new Map();
    client.knewDeleted = new Set(srv.knewDeleted);
    client.lineage = null;
    if (!srv.lineage) srv.lineage = newLineage(world, srv.rows.keys());
    const minted = `K${++world.version}`;
    const revision = ++srv.rev;
    srv.checkpoints.set(minted, { anchor: revision, heldAt: revision, createdAt: world.now });
    const clean = [...srv.checkpoints]
        .filter(([id, { anchor }]) => id !== minted && anchor > 0 && anchor >= srv.gcHigh)
        .map(([id]) => id);
    const adoptedGcHigh = srv.gcHigh;
    const virtual = ++client.rev;
    client.gcHigh = adoptedGcHigh > 0 ? virtual : 0;
    for (const id of [minted, ...clean]) {
        client.checkpoints.set(id, { anchor: virtual, heldAt: virtual, createdAt: world.now });
    }
    client.lineage = srv.lineage;
    return session(world, client, srv, { adoptedGcHigh });
}

/** The server's replica is replaced by the client's; see bootstrapServer. */
function bootstrap(world: World, client: Client, srv: Server, lineage: string): boolean {
    srv.rows = new Map();
    srv.checkpoints = new Map();
    srv.knewDeleted = new Set(client.knewDeleted);
    client.cursors.delete(srv.name);
    const revision = ++srv.rev;
    srv.gcHigh = client.gcHigh > 0 ? revision : 0;
    const prefix = client.rev;
    const bootstrapCheckpoint = `K${++world.version}`;
    srv.checkpoints.set(bootstrapCheckpoint, {
        anchor: revision,
        heldAt: revision,
        createdAt: world.now
    });
    for (const [id, { anchor }] of client.checkpoints) {
        if (anchor > 0 && anchor >= client.gcHigh && !srv.checkpoints.has(id)) {
            srv.checkpoints.set(id, { anchor: revision, heldAt: revision, createdAt: world.now });
        }
    }
    srv.lineage = lineage;
    client.addCheckpoints([[bootstrapCheckpoint, prefix]], world.now);
    client.lineage = lineage;
    return session(world, client, srv);
}

function sync(world: World, client: Client, srv: Server): SessionPlan {
    const cursors = client.cursor(srv);
    const offered = [...client.checkpoints].map(([id, { anchor }]) => ({ id, anchor }));
    const held = offered.filter(({ id }) => srv.checkpoints.has(id)).map(({ id }) => id);
    const plan = planSession(
        {
            lineage: client.lineage,
            hasRecords: client.rows.size > 0,
            safety: {
                gcHigh: client.gcHigh,
                coverage: coverage(cursors.push, offered, new Set(held))
            }
        },
        {
            lineage: srv.lineage,
            initializing: null,
            hasRecords: srv.rows.size > 0,
            safety: {
                gcHigh: srv.gcHigh,
                coverage: hooks.syncCoverage(
                    cursors.pull,
                    held.map((id) => srv.checkpoints.get(id)!.anchor)
                )
            }
        }
    );
    try {
        if (plan === 'sync') session(world, client, srv);
        else if (plan === 'adopt') adopt(world, client, srv);
        else if (plan === 'bootstrap') {
            const lineage = client.lineage ?? newLineage(world, client.rows.keys());
            bootstrap(world, client, srv, lineage);
        }
    } catch (error) {
        if (!(error instanceof Unsafe)) throw error;
    }
    return plan;
}

/** The user's choice on a conflict: keep this device (new lineage) or the server. */
function resolve(world: World, client: Client, srv: Server, choice: 'local' | 'server'): void {
    if (choice === 'server') adopt(world, client, srv);
    else bootstrap(world, client, srv, newLineage(world, client.rows.keys()));
}

function create(world: World, client: Client, id: string): void {
    client.write(id, { deleted: false, version: ++world.version }, world.now);
    member(world, client.lineage, id);
}

function remove(world: World, client: Client, id: string): void {
    client.write(id, { deleted: true, version: ++world.version }, world.now);
}

function assertInvariants(world: World, replicas: Replica[]): void {
    for (const replica of replicas) {
        for (const id of replica.liveIds()) {
            expect(replica.knewDeleted.has(id), `${id} resurrected on ${replica.name}`).toBe(false);
        }
        if (!replica.lineage) continue;
        const members = world.members.get(replica.lineage)!;
        for (const id of replica.rows.keys()) {
            expect(members.has(id), `${id} leaked into ${replica.lineage} on ${replica.name}`).toBe(
                true
            );
        }
    }
}

function setup() {
    return {
        now: 0,
        version: 0,
        lineages: 0,
        members: new Map<string, Set<string>>()
    } satisfies World;
}

describe('bootstrap, adoption and overwrite', () => {
    it('adopts collected deletions, then refuses a stale device 30 days later', () => {
        const world = setup();
        const [a, stale, fresh] = [new Client('A'), new Client('Stale'), new Client('Fresh')];
        const v = new Server('V');
        create(world, a, 'x');
        create(world, a, 'y');
        expect(sync(world, a, v)).toBe('bootstrap');
        expect(sync(world, stale, v)).toBe('adopt');
        remove(world, a, 'x');
        sync(world, a, v);
        world.now = 40;
        v.collect(world.now - RETENTION, Infinity);
        expect(sync(world, fresh, v)).toBe('adopt');
        expect(fresh.rows.has('x')).toBe(false);
        // Another GC cycle later the stale device returns with x still live.
        world.now = 80;
        sync(world, a, v);
        v.collect(world.now - RETENTION, Infinity);
        expect(sync(world, stale, v)).toBe('conflict');
        expect(sync(world, fresh, v)).toBe('sync');
        assertInvariants(world, [a, stale, fresh, v]);
    });

    it('keeps an overwritten lineage out of the new one', () => {
        const world = setup();
        const [a, b] = [new Client('A'), new Client('B')];
        const v = new Server('V');
        create(world, a, 'x');
        sync(world, a, v);
        sync(world, b, v);
        create(world, b, 'b-only');
        sync(world, b, v);
        resolve(world, a, v, 'local');
        expect(v.rows.has('b-only')).toBe(false);
        create(world, b, 'b-later');
        expect(sync(world, b, v)).toBe('conflict');
        expect(v.rows.has('b-later')).toBe(false);
        resolve(world, b, v, 'server');
        expect(b.rows.has('b-only')).toBe(false);
        assertInvariants(world, [a, b, v]);
    });
});

describe('randomized bootstrap, adoption and overwrite', () => {
    it('never resurrects a known deletion nor mixes lineages', { timeout: 60_000 }, () => {
        let seed = 4242;
        const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
        const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)];
        let conflicts = 0;
        let synced = 0;

        for (let run = 0; run < 400; run++) {
            const world = setup();
            const clients = [new Client('A'), new Client('B'), new Client('C')];
            const servers = [new Server('V1'), new Server('V2')];
            let nextId = 0;
            for (let step = 0; step < 60; step++) {
                const client = pick(clients);
                const srv = pick(servers);
                const roll = random();
                if (roll < 0.2) create(world, client, `r${nextId++}`);
                else if (roll < 0.32) {
                    const live = client.liveIds();
                    if (live.length > 0) remove(world, client, pick(live));
                } else if (roll < 0.75) {
                    const plan = sync(world, client, srv);
                    if (plan === 'conflict' || plan === 'init') {
                        conflicts++;
                        if (random() < 0.6)
                            resolve(world, client, srv, pick(['local', 'server'] as const));
                    } else synced++;
                } else if (roll < 0.87) srv.collect(world.now - RETENTION, Infinity);
                else world.now += Math.floor(random() * 20);
                assertInvariants(world, [...clients, ...servers]);
            }
        }
        expect(synced).toBeGreaterThan(conflicts);
    });
});
