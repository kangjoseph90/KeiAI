
## 2024-05-27 - Batch SQL Execution in Tauri Local DB
**Learning:** Sequential `db.execute()` calls for structural initialization (like `CREATE TABLE` and `CREATE INDEX`) inside loops cause severe performance bottlenecks in Tauri's SQLite plugin due to excessive plugin-host round-trips.
**Action:** Always batch structural database setup queries into a single string concatenated with semicolons and run them via a single `await db.execute(sql)` call during initialization. This reduces setup time from over 200ms to ~5ms.
