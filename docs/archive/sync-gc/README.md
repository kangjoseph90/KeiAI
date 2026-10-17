# Archived: tombstone GC and replica lifecycle

This branch preserves tombstone GC (Phase 1, merged as PR #95 and then reverted on `dev`) and the replica lifecycle built on it (Phase 2, PR #96, never merged). They were shelved because the cost of forgetting deletions spread into every neighbouring system, while keeping tombstones turned out to be cheap (see [Cost of keeping tombstones](#cost-of-keeping-tombstones)).

- `sync-gc-phase1` tag: the Phase 1 merge on `dev` (`fc9fb30`).
- `archive/sync-gc` branch: Phase 1 + Phase 2 + this note. The design is in [`../../sync-gc.md`](../../sync-gc.md).

## What it contains

- **Phase 1:**
  - tombstone GC with a per-scope `gcHigh` watermark;
  - History–Clean checkpoints and coverage proofs (`/api/sync/handshake`, `/api/sync/commit`), with fail-closed `unsafe_merge` / `init_required`;
  - a server commit-ordered revision (SQLite triggers) and keyset Pull;
  - atomic read-decide-write merges and batch-only sync writes;
  - one gate (`verifiedCoverage`) for Realtime and buffered Push.
- **Phase 2:**
  - scope lineage and `planSession` (sync / adopt / bootstrap / wait / init / conflict);
  - `/api/sync/bootstrap` with a client-chosen lease token and virtual GC, and `/api/sync/adopt`;
  - server lineage stamping and write guards;
  - replica epochs, and the conflict dialog (keep this device / keep server / later);
  - owner-only room overwrite, and asset localization before bootstrap;
  - integration tests against two real PocketBase servers (`pnpm test:pb`).

Phase 1 also fixed three bugs unrelated to GC. Reverting it brings them back on `dev`, so port these fixes separately:

- `serverUpdatedAt` was assigned by hooks in request order, so a Pull cursor could pass a change committed late. The fix assigns it with triggers from one `sync_revision` counter.
- Offset paging could skip a row when another row was updated mid-Pull. The fix pages by keyset on `serverUpdatedAt`.
- Pull and Push responses decided outside the write transaction, so a local deletion made during a Pull could be overwritten and then skipped by the Push cursor. The fix uses `chooseWinner` inside one transaction.

## Verification history

- An independent review and a Codex prove-or-refute model check were run for Phase 1: 7 counterexamples, 5 fixed, 1 tie case (equal `updatedAt`) excluded by decision.
- Phase 2 went through a Codex review (4 defects, fixed), then two model-check rounds (CE1–CE7, then R2-CE1/R2-CE2, all fixed). An external review followed (room overwrite permission and lease release order, fixed).
- A final cross-cutting review followed. Its open findings are below.

## Open findings at the time of shelving (cross-cutting review of 35768b8)

None of these were fixed. Any revival must address them first.

**Introduced by Phase 2**

| Area               | Finding                                                                                                                                                                                                                                                      | Severity                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| Local data         | Several Web tabs run independent engines over one IndexedDB with no coordination. Two tabs acting on one "keep server" choice delete records and advance cursors past them. Contradictory choices in two tabs can empty both the server and the local scope. | P1                          |
| Connection         | "Keep server" writes `adopting{discard}` with no server binding. Every retry after a failure wipes the scope again before the adopt request, deleting writes made since.                                                                                     | P1                          |
| Assets             | `localizeScope` (and `ConnectionService.localizeAssets`) only sees registry rows, which exist only for assets written or downloaded locally. Assets pulled but never opened are missed, so overwrite or init can lose them.                                  | P1                          |
| Assets / server    | Asset GC grace counts from catalog `createdAt`. An `exists` upload doesn't refresh it, so bytes can be collected right after an overwrite un-references them.                                                                                                | P1 (mechanism pre-existing) |
| Server             | The new fields were added to the already-applied init migration, so existing databases lose all sync.                                                                                                                                                        | P1 if any deployed DB       |
| Local data         | `record_buffer` entries survive a discard and are flushed back under the adopted lineage.                                                                                                                                                                    | P2                          |
| Rooms / server     | A lease is never released when its holder leaves, is revoked or deletes its account. Retries refresh `initAt`, so the lease never goes stale; the room waits until an owner device with data overwrites.                                                     | P2                          |
| Rooms / connection | Conflicts of inactive or left rooms stay listed; the dialog shows only the first. "Keep server" on one records a discard that runs on rejoin.                                                                                                                | P2                          |
| Connection         | `resolveConflict` can report the wrong result: a rerun is dropped after an error, or `stop()` clears state. `stopAutoSync` doesn't wait for an in-flight sync. Redo mints a new token, which can orphan the device's own lease.                              | P2                          |
| Accounts           | Deleting a local identity keeps its scope state. Signing in again offers an empty device "keep this device", which overwrites the server with nothing.                                                                                                       | P2                          |
| Server             | The bootstrap wipe loads every record of the scope in one write transaction and stalls all writes.                                                                                                                                                           | P2                          |

**Pre-existing (independent of GC)**

| Area       | Finding                                                                                                                                                                                      | Severity |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Accounts   | Deleting the server account leaves `sync_scopes` / checkpoints and local cursors. Re-creating the account (same id) syncs "successfully" from old cursors, so the server stays nearly empty. | P1       |
| Connection | A server reset to empty at the same URL is not detected: stale cursors pass coverage.                                                                                                        | P2       |
| Rooms      | Several local identities share a room's local replica; one identity's inaccessible-room purge wipes another's.                                                                               | P2       |
| Server     | No rate limits on sync endpoints; sync state rows survive account and room deletion.                                                                                                         | P3       |

## Cost of keeping tombstones

Measured on a real PocketBase with the repository schema and hooks: 1.56M rows, 1M of them other users' (`tombstone-bench.mjs`). Projected with `tombstone-model.py`. The behaviour assumptions in the model are guesses, not telemetry.

|                                     | Tombstone | Live message (conservatively small) |
| ----------------------------------- | --------- | ----------------------------------- |
| Server bytes per row, incl. indexes | 340 B     | 1,175 B                             |
| Client bytes per row (SQLite)       | 174 B     | 2,148 B                             |
| Pull response bytes per row         | 424 B     | 1,160 B                             |

Query latency did not change from 0 to 500k tombstones for one user: handshake about 1.4 ms, incremental Pull page about 1.5 ms. The only cost that grows is the full Pull a new device does. Assuming 80 ms RTT, 20 Mbps and 80 µs/row client processing:

| Persona (messages/day, share deleted) | After 5 years    | Extra time for a new device |
| ------------------------------------- | ---------------- | --------------------------- |
| Light (40, 20%)                       | 8k tombstones    | 5 s                         |
| Heavy (200, 50%)                      | 183k tombstones  | about 2 min                 |
| Power (800, 70%)                      | 1.02M tombstones | about 11 min                |

Server growth with 70/25/5% light/heavy/power users is about 0.7 GB/year per 100 users.

Before reviving GC, try cheaper mitigations for new-device time:

- gzip Pull responses;
- a larger Pull page;
- letting a deleted chat's tombstone stand for its messages' tombstones (needs its own correctness analysis).

## Reviving

1. Re-apply PR #95 on `dev`, or revert its revert.
2. Merge `archive/sync-gc` on top.
3. Resolve every open finding above.
4. Use the cross-cutting table as a checklist.

The external model-check artifacts were not kept in the repository.
