import { describe, expect, it } from 'vitest';
import {
    planSession,
    type LocalReplica,
    type RemoteReplica,
    type SessionPlan
} from '$lib/services/sync/safety';

const covered = { gcHigh: 5, coverage: 5 };
const uncovered = { gcHigh: 6, coverage: 5 };

const local = (patch: Partial<LocalReplica> = {}): LocalReplica => ({
    lineage: 'L',
    pendingLineage: null,
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
        [
            'same lineage, unproven, nothing local to lose',
            { hasRecords: false },
            { safety: uncovered },
            'adopt'
        ],
        ['other lineage, local data', {}, { lineage: 'M' }, 'conflict'],
        [
            'other lineage even with zero watermarks',
            { safety: { gcHigh: 0, coverage: 0 } },
            { lineage: 'M' },
            'conflict'
        ],
        ['other lineage, nothing local', { hasRecords: false }, { lineage: 'M' }, 'adopt'],
        ['never-synced device with data meets a replica', { lineage: null }, {}, 'init'],
        ['never-synced empty device', { lineage: null, hasRecords: false }, {}, 'adopt'],
        [
            'empty, uninitialized server',
            { lineage: null },
            { lineage: null, hasRecords: false },
            'bootstrap'
        ],
        ['empty server, initialized client', {}, { lineage: null, hasRecords: false }, 'bootstrap'],
        ['uninitialized server with data, local data', {}, { lineage: null }, 'conflict'],
        [
            'uninitialized server with data, nothing local',
            { hasRecords: false },
            { lineage: null },
            'adopt'
        ],
        ['another device initializing', {}, { initializing: 'active' }, 'wait'],
        [
            'own interrupted bootstrap',
            { pendingLineage: 'L' },
            { initializing: 'active' },
            'bootstrap'
        ],
        [
            'stale bootstrap of the same lineage, local data',
            {},
            { initializing: 'stale' },
            'conflict'
        ],
        [
            'stale bootstrap of the same lineage, nothing local',
            { hasRecords: false },
            { initializing: 'stale' },
            'wait'
        ],
        ['own stale bootstrap', { pendingLineage: 'L' }, { initializing: 'stale' }, 'bootstrap'],
        [
            'own bootstrap committed, response lost',
            { lineage: null, pendingLineage: 'L' },
            {},
            'sync'
        ],
        [
            'own overwrite committed, response lost',
            { lineage: 'K', pendingLineage: 'L' },
            {},
            'sync'
        ],
        [
            'stale bootstrap of another lineage, local data',
            {},
            { initializing: 'stale', lineage: 'M' },
            'conflict'
        ],
        [
            'stale bootstrap of another lineage, nothing local',
            { hasRecords: false },
            { initializing: 'stale', lineage: 'M' },
            'wait'
        ]
    ])('%s → %s', (_name, localPatch, remotePatch, plan) => {
        expect(planSession(local(localPatch), remote(remotePatch))).toBe(plan);
    });
});
