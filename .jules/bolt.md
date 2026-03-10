
## 2024-03-01 - Optimize Data Sync Pull with Promise.all
**Learning:** The `pullTable` function in `DataSyncService` previously performed sequential database queries (`localDB.getRecord`) inside a `for...of` loop over `result.items`. This caused severe N+1 latency, taking nearly ~500ms for 200 items.
**Action:** When working with local IndexedDB/SQLite adapters or decryption, use `Promise.all` to batch data reads (and subsequent writes if there are no dependencies). This optimization resulted in a >100x speedup in the sync catch-up pull.
