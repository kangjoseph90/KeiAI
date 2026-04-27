# PocketBase — AGENTS.md

Zero-knowledge sync backend: stores encrypted blobs, handles auth, syncs between devices. Never sees application plaintext.

```bash
# First run: copy config and set secrets
cp ../.env.example ../.env
# Edit .env: set PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD, PB_HOST, PB_PORT

node start.js     # http://localhost:8090 — creates admin, runs migrations, starts server
```

---

## What This Backend Does

- Stores and retrieves opaque encrypted blobs pushed by `app/`
- Authenticates users via PocketBase username/password where `username` is a user-chosen unique login alias and password is login key `X`
- Syncs records between devices via realtime subscriptions + LWW timestamps
- Serves account v2 endpoints for connect, recovery, and device pairing

## What This Backend Does NOT Do

- Decrypt, inspect, or validate any user data content
- Generate user identity; identity starts locally in `app/`
- Require email for auth or recovery
- Execute business logic (that lives entirely in `app/`)
- Log or store anything about AI API usage (that's the proxy's non-job)

---

## Schema

### Users (built-in auth collection + E2EE fields)

| Field                         | Purpose                                        |
| ----------------------------- | ---------------------------------------------- |
| `id`                          | Local userId chosen by the client              |
| `username`                    | Unique login alias                             |
| `passwordHash`                | PB hash of login key `X`, not the raw password |
| `email`                       | Optional contact email only                    |
| `salt`                        | PBKDF2 salt for client-side KDF                |
| `encryptedMasterKey`          | M wrapped with Y: M(Y)                         |
| `masterKeyIv`                 | IV for M(Y) encryption                         |
| `encryptedRecoveryMasterKey`  | M wrapped with Z: M(Z)                         |
| `recoveryMasterKeyIv`         | IV for M(Z) encryption                         |
| `recoveryAuthTokenHash`       | SHA-256 hash of recovery code back half        |
| `identityPublicKey`           | ECDH P-256 public key JWK                      |
| `encryptedIdentityPrivateKey` | Private key encrypted with M                   |
| `identityPrivateKeyIv`        | IV for private key encryption                  |

### Encrypted Tables (common shape)

All user data tables share this structure:

```
id, userId (plain text), createdAt, updatedAt,
encryptedData (text), encryptedDataIV (text), isDeleted (bool)
```

No PocketBase relation fields are used for domain ownership. Domain relationships stay in the encrypted payload unless a server feature explicitly needs a plain field.

Every table has a composite index on `(userId, updatedAt)` for sync queries.

---

## Custom Auth Endpoints (pb_hooks/main.pb.js)

### POST /api/account/salt

Looks up the salt for a username/password sign-in without revealing whether the username exists.

- Request: `{ username }`
- Response: `{ salt }`
- Existing accounts return their real salt
- Unknown usernames return a deterministic dummy salt derived from `DUMMY_SALT_SECRET`
- Rate-limited by IP

### POST /api/recovery/lookup

Finds a user by recovery code back-half hash and returns the encrypted recovery bundle.

- Request: `{ authTokenHash }`
- Response: userId, M(Z), identity public/private bundle, profile fields
- Uses constant-time comparison
- Rate-limited by IP

### POST /api/recovery/reset-password

Resets PB password (`X`), salt, M(Y), and recovery bundle after recovery-code verification.

### POST /api/recovery/delete

Deletes the remote account after recovery-code verification.

### POST /api/pairing

Stores a one-time encrypted device-pairing blob.

- Request: `{ id: lookupId, blob, ttl }`
- TTL is capped at 300 seconds
- Rate-limited by IP

### GET /api/pairing/{lookupId}

Fetches and immediately deletes a one-time pairing blob.

- Rate-limited by IP
- Missing, expired, or over-attempt entries return 404

---

## E2EE Auth Dance

```
Client                                  Server
  │                                        │
  │  POST /api/account/salt { username }   │
  │ ─────────────────────────────────────> │
  │                                { salt } │
  │                                        │
  │  PBKDF2(password, salt) → X, Y         │
  │  (client-side only)                    │
  │                                        │
  │  authWithPassword(username, X)         │
  │ ─────────────────────────────────────> │ Validates X as PB password
  │                                        │ Returns JWT + user record
  │                                        │
  │  unwrapMasterKey(M(Y), Y)              │
  │  (client-side only)                    │
```

The server never sees the raw password, Y, or M. It only stores X as a PB password hash and M(Y) as an opaque blob.

---

## Canonical Schema

PocketBase calls files in `pb_migrations/` migrations, but this project currently assumes a clean database. Treat `1773000000_init_keiai_schema.js` as the canonical schema definition.

- `1773000000_init_keiai_schema.js` — Creates all encrypted collections with proper fields, auth rules, and sync indices
- Auth rules on all encrypted tables: `userId = @request.auth.id` (users can only access their own data)
- Down migration drops all tables and removes E2EE fields from users

---

## See Also

- [app/AGENTS.md](../app/AGENTS.md) — Frontend architecture, service layer that consumes these APIs
- [docs/account-system-v2.md](../docs/account-system-v2.md) — Account system v2
- [docs/ADR.md](../docs/ADR.md) — Architecture decision records
