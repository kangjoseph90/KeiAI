# Tombstone GC and Merge Safety

Deleted records are kept as tombstones so a deletion wins over stale live copies. Tombstones are garbage-collected after a retention period. A replica that collected a tombstone has *forgotten* that deletion: if it later received the record live from a peer that never learned of the deletion, the record would silently come back. Every merge must therefore first prove that no forgotten deletion can be resurrected. When it cannot, sync stops before any data moves.

This is separate from LWW conflict resolution, which still decides between two known versions of a record.

## Positions and watermarks

Each replica orders its own changes: clients by `localUpdatedAt`, servers by `serverUpdatedAt`. Both are commit-ordered revisions, not clocks. On the server, SQLite triggers on the sync collections assign `serverUpdatedAt` from one `sync_revision` counter, inside the write transaction of the change. They fire on inserts and on updates that change a replicated field, so rejected or no-op writes keep their position. SQLite admits one writer at a time, so a visible revision N means every revision below it is committed, across JSVM runtimes, concurrent requests and batches. A rolled-back write takes its revision with it. `/api/now` returns the highest committed revision, so a Pull cursor advanced to it never skips a change. The server installs the triggers at startup and refuses sync writes and `/api/now` while any trigger is missing.

Per scope (user or room), each replica keeps:

- `gcHigh` — the highest own position of any tombstone it no longer stores. Every forgotten deletion lies at or below it.
- **Cursors** (clients only, per server) — Pull through a server position, Push through a local position.
- **Checkpoints** — `(id, anchor, heldAt)` records, defined below.

`tombstoneAt` is the time this replica first held the current tombstone version. Duplicate receives keep it, so resyncing never restarts retention. A newer tombstone version takes a fresh position, so its retention restarts with it: otherwise GC would raise `gcHigh` to a recent position and block peers that are well within retention. It is per-replica metadata, measured by each replica's own clock, never synced, and it only affects when GC runs, never whether a merge is safe.

## Knowledge

A replica *knows* a deletion if it holds the tombstone or has forgotten it (`gcHigh` covers it). A replica that knows a deletion never holds that record live again: tombstones win by delete-wins, and forgotten deletions are guarded by the checks below. Knowledge only grows.

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

1. **Handshake** (`POST /api/sync/handshake`): the client sends its Pull cursor and up to 500 checkpoint ids (own anchored ones first, then the newest inherited ones; leaving one out only weakens proofs). The server returns its `gcHigh`, its coverage of the client, and which ids it holds. The client classifies the result:
   - **safe** — both directions covered;
   - **needs_init** — one side has no safety state and the other has forgotten deletions (Phase 2: bootstrap and initial login);
   - **unsafe** — neither the cursors nor any checkpoint proves it.

   Anything but safe stops the session before Pull or Push. The status becomes `init_required` or `unsafe_merge`.
2. **Pull**: pages are keyset on `serverUpdatedAt`, so a row updated mid-Pull leaves the range instead of shifting an unread row out of it. Each page reads the local records, decides delete-wins/LWW, and writes in one transaction, so a local change committed during the Pull is merged instead of overwritten; Push responses do the same. A page containing an unknown live record is written only if `gcHigh` is still covered. If that check fails, the session stops before Push: nothing is pushed or committed. On Web the check and the write share one IndexedDB transaction. On Tauri the transaction helper is not atomic over the SQL plugin's connection pool. The watermark check does not depend on it, because client GC only removes tombstones at or below the Push cursor, which is always within the coverage being compared. The read-decide-write merge does: on Tauri a local change committed between the read and the write can still be overwritten. Unknown tombstones and updates to known records cannot resurrect anything and are always applied.
3. **Push**: each request carries `X-Kei-Sync-Coverage`. The server accepts `records`/`multi_room_records` writes only through `/api/batch`: the batch loads the original record and runs the hooks inside its transaction, so delete-wins arbitration and the create guard see committed state that GC cannot change before the write. It refuses a *live create* whose coverage is below its `gcHigh`. Updates and tombstone creates need no proof.
4. **Confirm**: if anything was pushed, the client pulls once more through a fresh bound so the confirmed range includes its own pushes. If that follow-up finds a local winner, the session falls back to the first bound.
5. **Commit** (`POST /api/sync/commit`): in one transaction the server re-checks its `gcHigh` against the coverage the session started with. A GC that raced the Pull fails the commit, and the Pull cursor does not advance. On success the server records inherited checkpoints, plus a new one when the Push completed. A client issues a new checkpoint for its first session with a server, and otherwise at most daily. The response lists the server's checkpoints within the Pull range.
6. The client stores the received checkpoints, then advances its cursors: Pull only after a successful commit, Push only after a complete Push.
7. **Client GC**: tombstones first held more than 30 days ago *and already pushed to this server* are removed. Checkpoints older than 60 days are pruned.

Server GC runs hourly. Per scope, it raises `gcHigh` and deletes expired tombstones at or below it in one transaction.

## Invariants

- **Watermark first**: on clients, every hard delete of a sync tombstone, including scope purges, raises `gcHigh` over it at or before the delete. On the server, GC raises `gcHigh` in the transaction that deletes, and the collection API allows no deletes. Only account deletion and the owner's room deletion remove records otherwise, and those end the scope itself. Interruption leaves `gcHigh` too high, which is conservative.
- **Cursor soundness**: forgotten deletions at or below a client's Push cursor were pushed before they were forgotten. Forgotten server deletions at or below a client's Pull cursor were pulled before they were forgotten. Each cursor only advances over ranges that the session's coverage or commit end-check proves.
- **Client GC stays covered**: a client only forgets tombstones already pushed to its current server, so its own GC never invalidates the relationship it is syncing.
- **Facts never become false**: History, anchors and `gcHigh` are monotone. Stale reads are conservative, and lost responses or crashes only drop proofs, never create them.

## Scope

- Only `records` and `multi_room_records` tombstones are collected. Room-index tombstones stay permanent because they gate room access.
- A replica that purged a scope keeps its watermark and checkpoints. Rejoining that scope reports an unsafe merge until Phase 2 adds reset/adoption.
- A client that has never synced cannot join a server that has collected tombstones (`needs_init`). Neither can a client whose forgotten deletions a fresh server cannot know. Bootstrap and adoption are Phase 2.

## Known limitations

- **Collection rebuilds drop the ordering triggers.** A PocketBase schema change that rebuilds a sync table removes its triggers. Sync writes and Pull bounds are then refused until the server restarts and reinstalls them.
- **Server restore from backup** rolls back knowledge and `gcHigh` while clients keep cursors and checkpoints for that server URL, so proofs about the restored server can be false.
