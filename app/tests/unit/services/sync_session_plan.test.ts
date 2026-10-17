import { describe, expect, it } from 'vitest';
import {
    planSession,
    type LocalReplica,
    type RemoteReplica,
    type SessionPlan
} from '$lib/services/sync/safety';

const covered = { gcHigh: 5, coverage: 5 };
const uncovered = { gcHigh: 6, coverage: 5 };
/** A replica that holds no records and has forgotten nothing. */
const empty: Partial<LocalReplica> = { hasRecords: false, safety: { gcHigh: 0, coverage: 0 } };

const local = (patch: Partial<LocalReplica> = {}): LocalReplica => ({
    lineage: 'L',
    hasRecords: true,
    safety: covered,
    ...patch
});

const remote = (patch: Partial<RemoteReplica> = {}): RemoteReplica => ({
    lineage: 'L',
    initializing: null,
    hasRecords: true,
    safety: covered,
    ...patch
});

describe('planSession', () => {
    it.each<[string, Partial<LocalReplica>, Partial<RemoteReplica>, SessionPlan]>([
        ['same lineage, both proven', {}, {}, 'sync'],
        ['same lineage, local unproven, local data', { safety: uncovered }, {}, 'conflict'],
        ['same lineage, remote unproven, local data', {}, { safety: uncovered }, 'conflict'],
        ['same lineage, unproven, nothing local to lose', empty, { safety: uncovered }, 'adopt'],
        [
            'same lineage, GC emptied the replica but it still knows deletions',
            { hasRecords: false, safety: uncovered },
            { safety: uncovered },
            'conflict'
        ],
        [
            'another lineage, GC emptied the replica',
            { hasRecords: false, safety: covered },
            { lineage: 'M' },
            'conflict'
        ],
        [
            'discarded replica (purged): forgotten deletions without lineage',
            { lineage: null, hasRecords: false, safety: covered },
            {},
            'adopt'
        ],
        ['other lineage, local data', {}, { lineage: 'M' }, 'conflict'],
        [
            'other lineage even with zero watermarks',
            { safety: { gcHigh: 0, coverage: 0 } },
            { lineage: 'M' },
            'conflict'
        ],
        ['other lineage, nothing local', empty, { lineage: 'M' }, 'adopt'],
        ['never-synced device with data meets a replica', { lineage: null }, {}, 'init'],
        ['never-synced empty device', { ...empty, lineage: null }, {}, 'adopt'],
        [
            'empty, uninitialized server',
            { lineage: null },
            { lineage: null, hasRecords: false },
            'bootstrap'
        ],
        ['empty server, initialized client', {}, { lineage: null, hasRecords: false }, 'bootstrap'],
        ['uninitialized server with data, local data', {}, { lineage: null }, 'conflict'],
        ['uninitialized server with data, nothing local', empty, { lineage: null }, 'adopt'],
        ['another device initializing', {}, { initializing: 'active' }, 'wait'],
        ['own lease, active', {}, { initializing: 'own' }, 'bootstrap'],
        ['own lease, another lineage', {}, { initializing: 'own', lineage: 'M' }, 'bootstrap'],
        ['stale lease of the same lineage, local data', {}, { initializing: 'stale' }, 'conflict'],
        [
            'stale lease of the same lineage, nothing local',
            empty,
            { initializing: 'stale' },
            'wait'
        ],
        [
            'stale lease, GC emptied the replica',
            { hasRecords: false },
            { initializing: 'stale' },
            'conflict'
        ],
        [
            'stale lease of another lineage, local data',
            {},
            { initializing: 'stale', lineage: 'M' },
            'conflict'
        ],
        [
            'stale lease of another lineage, nothing local',
            empty,
            { initializing: 'stale', lineage: 'M' },
            'wait'
        ]
    ])('%s', (_name, localPatch, remotePatch, plan) => {
        expect(planSession(local(localPatch), remote(remotePatch))).toBe(plan);
    });
});
