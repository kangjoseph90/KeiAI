# Tombstone GC and Merge Safety

Deleted records are kept as tombstones so a deletion wins over stale live copies. Tombstones are garbage-collected after a retention period. A replica that collected a tombstone has _forgotten_ that deletion: if it later received the record live from a peer that never learned of the deletion, the record would silently come back. Every merge must therefore first prove that no forgotten deletion can be resurrected. When it cannot, sync stops before any data moves.

This is separate from LWW conflict resolution, which still decides between two known versions of a record.

## Positions and watermarks

Each replica orders its own changes: clients by `localUpdatedAt`, servers by `serverUpdatedAt`. Both are commit-ordered revisions, not clocks. On the server, SQLite triggers on the sync collections assign `serverUpdatedAt` from one `sync_revision` counter, inside the write transaction of the change. They fire on inserts and on updates that change a replicated field, so rejected or no-op writes keep their position. SQLite admits one writer at a time, so a visible revision N means every revision below it is committed, across JSVM runtimes, concurrent requests and batches. A rolled-back write takes its revision with it. `/api/now` returns the highest committed revision, so a Pull cursor advanced to it never skips a change. The server installs the triggers at startup and refuses sync writes and `/api/now` while any trigger is missing.

Per scope (user or room), each replica keeps:

- `gcHigh` — the highest own position of any tombstone it no longer stores. Every forgotten deletion lies at or below it.
- **Cursors** (clients only, per server) — Pull through a server position, Push through a local position.
- **Checkpoints** — `(id, anchor, heldAt)` records, defined below.

`tombstoneAt` is the time this replica first held the current tombstone version. Duplicate receives keep it, so resyncing never restarts retention. A newer tombstone version takes a fresh position, so its retention restarts with it: otherwise GC would raise `gcHigh` to a recent position and block peers that are well within retention. It is per-replica metadata, measured by each replica's own clock, never synced, and it only affects when GC runs, never whether a merge is safe.

## Knowledge

A replica _knows_ a deletion if it holds the tombstone or has forgotten it (`gcHigh` covers it). A replica that knows a deletion never holds that record live again: tombstones win by delete-wins, and forgotten deletions are guarded by the checks below. Knowledge only grows.

A merge where replica R receives state from peer P is safe when every deletion R has forgotten is known by P. This is checked in both directions, because a client ingests from a server (Pull) and a server ingests from a client (Push).

## History–Clean checkpoints

A checkpoint K is issued at the end of a verified client–server session. Its deletion set D(K) is the client's knowledge through the session's Push bound plus the server's knowledge through the confirmed Pull bound.

- **History(R, K)**: R knows every deletion in D(K). The co-issuing pair gets History when K is issued. Other replicas get it only by inheriting K inside a verified range: a client inherits the server's checkpoints whose `heldAt` lies in its confirmed Pull range, and a server inherits the client's checkpoints whose `heldAt` lies in its completed Push range. Sharing an id without that state transfer never confers History.
- **Clean(R, K)**: `gcHigh_R <= anchor_R(K)`. The anchor is the co-issuer's own session bound, and everything it knew at or below the anchor is in D(K). Inherited checkpoints have anchor 0, so they only serve as History. GC raises `gcHigh` in the same atomic step that removes tombstones, which automatically invalidates every checkpoint anchored below it; no separate invalidation write can be lost.

**Coverage** of R's forgotten deletions by peer P is the larger of the direct cursor (a client's Push cursor, or the server's view of the client's Pull cursor) and `anchor_R(K)` for any K that P holds. The direction is safe exactly when `gcHigh_R <= coverage`.

Two replicas that never synced directly can merge safely through a K one side is clean on and the other inherited.

## Outside a full session

Realtime Pull, buffered Push of local writes, and Realtime correction Push all pass one gate. It admits a scope only while the engine holds a session verified by a full handshake against that same server.

- **Unverified**: nothing merges or sends, and a full sync is requested.
- **Blocked** (the last session attempt failed: unsafe, needs initialization, or any other error): the scope waits for the regular sync triggers instead of retrying on every event. A buffered flush keeps reporting the blocking error, and the other scopes are still pushed.

The gate is synchronous and returns the session's cached coverage, which rises with every cursor the session advances. **Coverage is taken before the data it authorizes**: a Realtime event captures it on arrival, before any await, and a buffered or correction Push takes it first and reads the records afterwards. Data newer than its proof is safe; data older than its proof could predate a deletion the proof already accounts for.

Realtime subscriptions are pinned to the server they were opened on, and a Push aborts if the active server changed after the gate. Held events stay above the Pull cursor and held local changes stay above the Push cursor, so the next verified session recovers both. Passing the gate grants no write by itself. A Realtime merge first checks, in its write transaction, that the local `gcHigh` is still covered; a Push first checks the same against the cached proof; and the server still checks every live create in its own write transaction. Otherwise nothing moves and the scope is re-verified.

## Session protocol

1. **Handshake** (`POST /api/sync/handshake`): the client sends its Pull cursor, its lineage and up to 500 checkpoint ids (own anchored ones first, then the newest inherited ones; leaving one out only weakens proofs). The server returns its `gcHigh`, its coverage of the client, which ids it holds, and the scope's lineage, initialization lease and whether it holds any record. The client plans the session (see [Replicas and lineage](#replicas-and-lineage)); only `sync` proceeds to Pull and Push here.
2. **Pull**: pages are keyset on `serverUpdatedAt`, so a row updated mid-Pull leaves the range instead of shifting an unread row out of it. Each page reads the local records, decides delete-wins/LWW, and writes in one transaction, so a local change committed during the Pull is merged instead of overwritten; Push responses do the same. A page containing an unknown live record is written only if `gcHigh` is still covered. If that check fails, the session stops before Push: nothing is pushed or committed. On Web the check and the write share one IndexedDB transaction. On Tauri the transaction helper is not atomic over the SQL plugin's connection pool. The watermark check does not depend on it, because client GC only removes tombstones at or below the Push cursor, which is always within the coverage being compared. The read-decide-write merge does: on Tauri a local change committed between the read and the write can still be overwritten. Unknown tombstones and updates to known records cannot resurrect anything and are always applied.
3. **Push**: each request carries `X-Kei-Sync-Coverage`. The server accepts `records`/`multi_room_records` writes only through `/api/batch`: the batch loads the original record and runs the hooks inside its transaction, so delete-wins arbitration and the create guard see committed state that GC cannot change before the write. It refuses a _live create_ whose coverage is below its `gcHigh`. Updates and tombstone creates need no proof.
4. **Confirm**: if anything was pushed, the client pulls once more through a fresh bound so the confirmed range includes its own pushes. If that follow-up finds a local winner, the session falls back to the first bound.
5. **Commit** (`POST /api/sync/commit`): in one transaction the server re-checks the lineage and its `gcHigh` against the coverage the session started with (and, after an adoption, against the adopted watermark). A GC that raced the Pull fails the commit, and the Pull cursor does not advance. On success the server records inherited checkpoints, plus a new one when the Push completed. A client issues a new checkpoint for its first session with a server, and otherwise at most daily. The response lists the server's checkpoints within the Pull range.
6. The client stores the received checkpoints, then advances its cursors: Pull only after a successful commit, Push only after a complete Push.
7. **Client GC**: tombstones first held more than 30 days ago _and already pushed to this server_ are removed. Checkpoints older than 60 days are pruned.

Server GC runs hourly. Per scope, it raises `gcHigh` and deletes expired tombstones at or below it in one transaction.

## Invariants

- **Watermark first**: on clients, every hard delete of a sync tombstone, including scope purges, raises `gcHigh` over it at or before the delete. On the server, GC raises `gcHigh` in the transaction that deletes, and the collection API allows no deletes. Only account deletion and the owner's room deletion remove records otherwise, and those end the scope itself. Interruption leaves `gcHigh` too high, which is conservative.
- **Cursor soundness**: forgotten deletions at or below a client's Push cursor were pushed before they were forgotten. Forgotten server deletions at or below a client's Pull cursor were pulled before they were forgotten. Each cursor only advances over ranges that the session's coverage or commit end-check proves.
- **Client GC stays covered**: a client only forgets tombstones already pushed to its current server, so its own GC never invalidates the relationship it is syncing.
- **Facts never become false**: History, anchors and `gcHigh` are monotone. Stale reads are conservative, and lost responses or crashes only drop proofs, never create them.

## Scope

- Only `records` and `multi_room_records` tombstones are collected. Room-index tombstones stay permanent because they gate room access.
- A replica that purged a scope keeps its watermark and checkpoints. A purged scope holds no records, so rejoining it adopts the server's replica.

## Replicas and lineage

Each scope replica belongs to a **lineage**, a random id the server assigns when the scope is first initialized. Replicas of different lineages never merge: they are unrelated histories, and neither side's watermarks say anything about the other. An overwrite always starts a new lineage, so a device that still holds the replaced history cannot write it back. Zero watermarks never mean "empty" or "initialized": emptiness is whether the scope holds any record (live or tombstone), and initialization is whether it has a lineage.

The server stamps every accepted record with the scope's lineage. Writes must carry `X-Kei-Sync-Lineage` matching it, Pull and Realtime drop records of another lineage, and the commit refuses a session of another lineage. A buffered Push still in flight when its scope is overwritten is therefore refused.

`planSession` decides from both sides' lineage, emptiness and coverage:

| Plan        | When                                                                                                     |
| ----------- | -------------------------------------------------------------------------------------------------------- |
| `sync`      | Same lineage, both directions covered.                                                                   |
| `adopt`     | The local scope holds no records and the server's is usable. Automatic.                                  |
| `bootstrap` | The server scope is uninitialized and empty, or the lease is this device's own interrupted bootstrap.    |
| `wait`      | Another device is initializing the server scope (`server_initializing`).                                 |
| `init`      | A never-synced device with local data meets an initialized server (`init_required`).                     |
| `conflict`  | Different lineages, or the same lineage without a proof, with local data on both sides (`unsafe_merge`). |

Data is never discarded automatically. `init` and `conflict` stop the scope until the user chooses: **keep this device** overwrites the server scope, **keep server** overwrites the local scope, or cancel. Other scopes and servers keep syncing.

### Bootstrap and overwrite (server ← client)

`POST /api/sync/bootstrap` (`mode: init` requires an uninitialized, empty, unleased scope; `overwrite` requires the expected lineage) wipes the scope's records and checkpoints, sets the new lineage and takes a 1h **initialization lease** (`initToken`). Only writes carrying `X-Kei-Sync-Bootstrap` with that token are accepted while it holds; other devices get `server_initializing`. The client pushes its whole replica in a normal session that carries the token, and the commit releases the lease. An interrupted bootstrap is resumed by the same device (`bootstrapping` in the local scope state), or by any device of the same lineage once the lease is stale. A partial initialization is never a valid replica.

The server inherits the client's knowledge with **virtual GC**: if the client has forgotten deletions, the server sets `gcHigh` to a fresh revision ι0 instead of 0. The bootstrap checkpoint K0 (client anchor: its local prefix) and the client's clean checkpoints are stored with anchor ι0, so the bootstrapping device and every device that is clean on those checkpoints can follow, while a device that cannot prove it knows the forgotten deletions is refused.

### Adoption (client ← server)

The engine marks the scope `adopting`, drops the cursors, scope assets, records, `gcHigh` and checkpoints, then calls `POST /api/sync/adopt`. The server mints a checkpoint at its current revision and returns it with its lineage, `gcHigh` and up to 100 clean checkpoints. If the server has forgotten deletions the client sets its own `gcHigh` to a fresh revision ι with those checkpoints anchored at ι, so it can never ingest a stale copy from a peer that cannot prove the deletions. The first session pulls everything and its commit fails if the server collected past the adopted watermark meanwhile. An interrupted adoption restarts from scratch.

## Known limitations

- **Collection rebuilds drop the ordering triggers.** A PocketBase schema change that rebuilds a sync table removes its triggers. Sync writes and Pull bounds are then refused until the server restarts and reinstalls them.
- **Tauri transactions are not atomic.** On Tauri, resetting a scope for adoption is a sequence of statements. A crash leaves the scope marked `adopting`, so the next sync restarts the adoption.
- **Other servers after an overwrite.** Servers still holding the replaced lineage report a conflict to every device, including the one that overwrote; resolve them one by one.
- **A stale lease of another lineage** blocks empty devices (`wait`) until a device holding data resolves it.
- **Server restore from backup** rolls back knowledge and `gcHigh` while clients keep cursors and checkpoints for that server URL, so proofs about the restored server can be false.
