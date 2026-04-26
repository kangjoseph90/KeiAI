# PocketBase — AGENTS.md

Zero-knowledge sync backend: stores encrypted blobs, handles auth, syncs between devices. Never sees application plaintext.

```bash
# First run: copy config and set secrets
cp pocketbase.config.example.json pocketbase.config.json
# Edit pocketbase.config.json: set adminEmail, adminPassword, dummySaltSecret

node start.js     # http://localhost:8090 — creates admin, runs migrations, starts server
```

---

## What This Backend Does

- Stores and retrieves opaque encrypted blobs pushed by `app/`
- Authenticates users via email/password (login key `X`, not the actual password)
- Syncs records between devices via realtime subscriptions + LWW timestamps
- Serves the E2EE auth dance endpoints (salt, recovery bundle, account recovery)

## What This Backend Does NOT Do

- Decrypt, inspect, or validate any user data content
- Execute business logic (that lives entirely in `app/`)
- Log or store anything about AI API usage (that's the proxy's non-job)

---

## Schema

### Users (built-in auth collection + E2EE fields)

| Field                       | Purpose                                  |
| --------------------------- | ---------------------------------------- |
| `email`, `passwordHash`     | Standard auth (password = hashed login key X) |
| `salt`                      | PBKDF2 salt for client-side KDF          |
| `encryptedMasterKey`        | M wrapped with Y: M(Y)                  |
| `masterKeyIv`               | IV for M(Y) encryption                  |
| `encryptedRecoveryMasterKey`| M wrapped with Z: M(Z)                  |
| `recoveryMasterKeyIv`       | IV for M(Z) encryption                  |
| `recoveryAuthTokenHash`     | SHA-256 hash of recovery auth token      |

### Encrypted Tables (common shape)

All user data tables share this structure:

```
id, userId (plain text), createdAt, updatedAt,
encryptedData (text), encryptedDataIV (text), isDeleted (bool)
```

No PocketBase relation fields are used for domain ownership. Domain relationships stay in the encrypted payload unless a server feature explicitly needs a plain field.

| Table                | Extra Fields     | Notes                          |
| -------------------- | --------------- | ------------------------------ |
| `characters`         | —               | Character data + refs          |
| `chats`              | —               | Character refs are encrypted payload |
| `messages`           | —               | Chat refs are encrypted payload |
| `lorebooks`          | —               | Owner refs are encrypted payload |
| `scripts`            | —               | Same ownership model           |
| `settings`           | —               | One record per user            |
| `personas`           | —               |                                |
| `modules`            | —               |                                |
| `plugins`            | —               |                                |
| `presets`            | —               | Prompt preset data             |
| `assets`             | —               | Asset metadata                 |

Every table has a composite index on `(userId, updatedAt)` for sync queries.

### Schema Philosophy

- **Single-table entities**: Each entity type uses one table with one encrypted blob
- **No PocketBase FKs** for domain records — soft deletes + client-side self-healing
- **Clean-schema phase**: update the canonical init schema directly; do not add incremental migration files

---

## Custom Auth Endpoints (pb_hooks/main.pb.js)

### GET /api/salt/{email}

Returns the user's PBKDF2 salt before login (client needs it to derive X and Y).

- **No authentication required**
- Returns a **deterministic dummy salt** (HMAC of email) for unknown emails — prevents email enumeration
- Rate-limited: 20 requests/minute per IP

### GET /api/recovery-bundle/{email}

Returns the encrypted recovery master key bundle M(Z).

- **No authentication required**
- Returns empty strings for unknown emails (client fails at decryption, not at lookup)
- Rate-limited: 5 requests/minute per IP

### POST /api/recover-account/{email}

Resets password and re-wraps master key using a recovery code.

- Validates recovery auth token via **constant-time comparison** (timing-attack safe)
- Rate-limited: 5/min per IP AND 5/5min per email (distributed brute-force protection)
- Updates: password, salt, encryptedMasterKey, masterKeyIv, recovery bundle, recovery auth token hash
- Returns generic `"Recovery failed."` for all error conditions (no information leakage)

---

## E2EE Auth Dance (How Login Works)

```
Client                              Server
  │                                    │
  │  GET /api/salt/{email}             │
  │ ──────────────────────────────────>│ Returns salt (or dummy)
  │                                    │
  │  PBKDF2(password, salt) → X, Y    │
  │  (client-side only)               │
  │                                    │
  │  POST auth-with-password(email, X) │
  │ ──────────────────────────────────>│ Validates X as password
  │                                    │ Returns JWT + user record
  │                                    │
  │  unwrapMasterKey(M(Y), Y)         │
  │  (client-side only — M is live)   │
```

The server never sees the real password, Y, or M. It only stores X (as hashed password) and M(Y) (opaque blob).

---

## Configuration (pocketbase.config.json)

```json
{
    "adminEmail": "admin@example.com",
    "adminPassword": "secure-password",
    "dummySaltSecret": "random-secret-for-dummy-salt-hmac",
    "host": "127.0.0.1",
    "port": 8090
}
```

- **Never commit** `pocketbase.config.json` — it contains secrets
- `dummySaltSecret` must be a strong random string (used for HMAC dummy salts)
- `start.js` validates config, creates admin superuser, injects `DUMMY_SALT_SECRET` as env var

---

## Canonical Schema

PocketBase calls files in `pb_migrations/` migrations, but this project currently assumes a clean database. Treat `1773000000_init_keiai_schema.js` as the canonical schema definition.

- `1773000000_init_keiai_schema.js` — Creates all encrypted collections with proper fields, auth rules, and sync indices
- Auth rules on all encrypted tables: `userId = @request.auth.id` (users can only access their own data)
- Down migration drops all tables and removes E2EE fields from users

### Adding a New Encrypted Table

1. Edit `1773000000_init_keiai_schema.js`
2. Use the sync-table helper from the init schema pattern
3. The helper adds: `userId` (plain text), `createdAt`, `updatedAt`, `encryptedData`, `encryptedDataIV`, `isDeleted`, plus your extra fields
4. Creates `idx_{name}_sync` on `(userId, updatedAt)`
5. Update `app/src/lib/adapters/db/types.ts` and `app/src/lib/adapters/db/web.ts` with the new table

---

## Development

```bash
node start.js           # Start with config validation + admin setup
# Admin UI: http://localhost:8090/_/
# API:      http://localhost:8090/api/
```

PocketBase binary must be downloaded separately from https://pocketbase.io/docs/ and placed in the `pocketbase/` directory.

---

## See Also

- [app/AGENTS.md](../app/AGENTS.md) — Frontend architecture, service layer that consumes these APIs
- [notes/Idea.md](../notes/Idea.md) — Comprehensive architecture design document
- [notes/keiai_data_schema_philosophy.md](../notes/keiai_data_schema_philosophy.md) — Data schema philosophy
