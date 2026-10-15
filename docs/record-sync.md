# Record sync clocks

Content (`records`, including room content) and room metadata (`multi_meta`) use three independent values:

| Value             | Authority                 | Meaning                                                                             |
| ----------------- | ------------------------- | ----------------------------------------------------------------------------------- |
| `updatedAt`       | Originating replica       | Existing LWW version; delete-wins rules remain unchanged.                           |
| `serverUpdatedAt` | Server                    | Accepted server change order; Pull scans `(serverPullCursor, serverUpper]`.         |
| `localUpdatedAt`  | Local persistence adapter | Committed local canonical change order; Push scans `(localPushCursor, localUpper]`. |

The adapter assigns `localUpdatedAt` on actual persisted state changes: local edits, bulk writes, soft deletion, and accepted Pull, Realtime, or Push-response changes. Identical writes (including repeated remote deliveries) preserve it. Rejected remote versions never reach persistence. Metadata alone cannot advance the sequence. Newer LWW versions still change canonical state even when the domain payload is identical.

Each local database retains a monotonic change counter. IndexedDB writes the record and counter in one transaction. SQLite triggers update both in the same statement, including direct bulk soft deletes; conflict updates preserve the sequence for identical rows. The counter survives restarts, clock rollback, and local purges. Content and multi metadata use their own IndexedDB counters; SQLite shares one counter in `KeiLocalDB.db`. Gaps do not affect scans.

Full sync captures the committed local counter as `localUpper` **before** pulling. Only a successful Push advances its cursor through that bound. Changes accepted during the run have larger local sequences and remain eligible for the next run, including after a restart. Buffered local writes and conflict-repair pushes retain their existing behavior and do not advance the scan cursor. A change imported from another server is therefore eligible for an existing server even if its `updatedAt` is below that server's local Push cursor.

`localUpdatedAt` is optional only on unsaved input records; adapters always populate persisted rows. Caller-supplied values are ignored. The value is neither a wire field nor part of the encrypted record payload, and is never imported from a remote payload. No server column is required.

This schema assumes clean local databases. There is no existing-data backfill, schema upgrade, or cursor migration. History, GC, and Overwrite behavior are unchanged.
