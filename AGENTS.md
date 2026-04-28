# KeiAI — Monorepo AGENTS.md

Local-first AI character chat application with encrypted cloud sync. Uses pnpm workspaces.

---

## Quick Start

```bash
# Frontend (app/)
cd app && pnpm install && pnpm dev     # http://localhost:5173

# Backend (pocketbase/)
cd pocketbase && node start.js         # http://localhost:8090

# Proxy (proxy/)
cd proxy && pnpm install && pnpm dev   # Local wrangler
```

---

## What Goes Where

| Directory     | Purpose                                          | Docs                                                             |
| ------------- | ------------------------------------------------ | ---------------------------------------------------------------- |
| `app/`        | Svelte frontend, E2EE engine, all client logic   | [app/AGENTS.md](app/AGENTS.md), [app/TESTING.md](app/TESTING.md) |
| `pocketbase/` | Blind data store, auth hooks, encrypted sync     | [pocketbase/AGENTS.md](pocketbase/AGENTS.md)                     |
| `proxy/`      | Stateless AI API forwarding (Cloudflare Workers) | [proxy/AGENTS.md](proxy/AGENTS.md)                               |
| `notes/`      | Architecture philosophy, design docs             | Reference only                                                   |

---

## Security Model (Zero-Knowledge)

This is the single most important design constraint. Every decision flows from it.

- **Local data is stored as plaintext domain JSON** in the app database
- **All synced user data is encrypted client-side** (AES-256-GCM) before leaving the browser
- The server stores and syncs opaque encrypted blobs — it never sees plaintext
- The master key `M` is generated with the local identity and remains extractable for sync wrapping, recovery, and device transfer
- The proxy is stateless; it forwards AI API requests without logging or inspection
- Recovery uses a separate key path (recovery code → Z → M(Z)) that never touches the server in cleartext

When adding any new feature or data type, ask: **"Does the server need to read this?"** The answer should almost always be **no**.

---

## Data Flow

```
User Input → Service → Adapter (plaintext IndexedDB/SQLite) → Sync (encrypt + push blob) → PocketBase
PocketBase → Sync (pull blob + decrypt) → Adapter (plaintext IndexedDB/SQLite) → Service (deepMerge defaults) → Store → UI
```

- Domain types and business logic live in `app/`; PocketBase only stores what `app/` pushes
- PocketBase defines the sync API contract. During the clean-schema phase, change the canonical init schema instead of adding incremental migrations
- Domain types in `app/src/lib/shared/types.ts` are the shared vocabulary across all layers

---

## Cross-Cutting Conventions

- **No `any` type** anywhere in TypeScript code
- **Defensive spread order**: Always put metadata (id, userId, etc.) after spreads (e.g., `{ ...data, id }`) to prevent accidental overwrites from untrusted data blobs.
- **Type-check before commit**: `pnpm check` in `app/`
- **Test after every module change**: write test → pass → then move on
- Refer to each subproject's AGENTS.md for layer-specific rules

---

## Documentation

| Document                      | Path                                               | When to Update                                       |
| ----------------------------- | -------------------------------------------------- | ---------------------------------------------------- |
| Architecture design           | [docs/IDEA.md](docs/IDEA.md)                       | When a major system concept changes                  |
| Architecture Decision Records | [docs/ADR.md](docs/ADR.md)                         | When a structural design decision is made or changed |
| Data schema philosophy        | [docs/schema.md](docs/schema.md)                   | When relationship or storage patterns change         |
| Asset system spec             | [docs/asset-system-v3.md](docs/asset-system-v3.md) | When asset pipeline changes                          |
| Roadmap                       | [docs/TODO.md](docs/TODO.md)                       | When milestones shift                                |

---

## See Also

- [app/AGENTS.md](app/AGENTS.md) — Frontend architecture, layering, conventions
- [app/TESTING.md](app/TESTING.md) — Testing guidelines (Vitest, mocking patterns)
- [pocketbase/AGENTS.md](pocketbase/AGENTS.md) — Backend schema, hooks, auth dance
- [proxy/AGENTS.md](proxy/AGENTS.md) — Stateless proxy rules
- [docs/IDEA.md](docs/IDEA.md) — Comprehensive architecture design document
- [docs/ADR.md](docs/ADR.md) — Architecture decision records
- [docs/schema.md](docs/schema.md) — Data schema philosophy
- [docs/asset-system-v3.md](docs/asset-system-v3.md) — Asset system specification
- [docs/TODO.md](docs/TODO.md) — Development roadmap
