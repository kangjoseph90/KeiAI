# KeiAI

> Local-first AI character chat application with client-side end-to-end encryption.

**⚠️ Work in Progress** — Core architecture and backend are solid; frontend features are actively being built.

## What is this?

KeiAI is a BYOK AI character chat app where **the server never sees your data**. All messages, characters, and settings are encrypted client-side with AES-256-GCM before leaving the browser. The server is a blind store that syncs opaque blobs between devices.

Think of it as a privacy-first alternative to existing AI chat frontends — with multi-device sync, offline support, and zero-knowledge architecture baked in from day one.

## Architecture

```
┌──────────────────────────────────────────────────┐
│  Frontend — SvelteKit + Svelte 5 + Tailwind      │
│                                                  │
│  Views → Stores → Services → Adapters            │
│                    (encrypt)   (Web / Tauri)      │
├──────────────────────────────────────────────────┤
│  Cross-Cutting                                   │
│  types/ · utils/ · llm/ · tasks/ · crypto/       │
└──────────┬──────────────────────┬────────────────┘
           │                      │
     PocketBase              CF Workers Proxy
     (blind sync)            (stateless relay)
```

- **4-layer separation** — UI → Stores → Services → Adapters with strict import rules
- **Platform abstraction** — Every I/O operation has Web and Tauri adapters behind a shared interface
- **E2EE everywhere** — Master key exists only in memory or as a non-extractable CryptoKey
- **Guest-first** — Works offline with no account; sign up later to enable multi-device sync

## Security Model

```
Password → PBKDF2(600k iterations) → 512 bits → split
  ├─ X (first half) → login credential (server stores H(X))
  └─ Y (second half) → wraps master key M → M(Y) sent to server

Server stores: salt, H(X), M(Y) — never sees password, Y, or M
Recovery: independent key path via recovery code
```

- All user content encrypted with AES-256-GCM (fresh IV per operation)
- Server cannot decrypt anything — auth is against H(X) only
- Account recovery without server-side plaintext access
- Constant-time comparisons + rate limiting on all auth endpoints

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | SvelteKit, Svelte 5, TypeScript, Tailwind CSS 4 |
| Desktop / Mobile | Tauri 2 |
| Local DB | Dexie (IndexedDB) / SQLite (Tauri) |
| Backend | PocketBase with custom auth hooks |
| Proxy | Cloudflare Workers |
| Crypto | Web Crypto API (AES-256-GCM, PBKDF2, ECDH) |
| Testing | Vitest |
| Monorepo | pnpm workspaces |

## Project Structure

```
keiai/
├── app/            SvelteKit frontend — all client logic + E2EE engine
├── pocketbase/     Blind data store — auth hooks, encrypted sync
├── proxy/          Stateless AI API relay (Cloudflare Workers)
└── docs/           Architecture docs, ADRs, design specs
```

## Current Status

### ✅ Done
- E2EE engine — encryption, key derivation, guest/register/login/recovery flows
- 4-layer frontend architecture with 11 platform adapters (Web + Tauri)
- Content services with encrypt-decrypt-merge lifecycle
- Multi-device sync (LWW + realtime WebSocket + fallback polling)
- Asset system with content-hash deduplication
- LLM streaming pipeline with model type system
- PocketBase backend with rate-limited auth endpoints
- Stateless proxy with SSRF protection
- Unit test suite across all layers

### 🚧 In Progress
- LLM provider coverage (additional formats beyond OpenAI-compatible)
- Character and preset editor UIs
- Feature parity with existing AI chat frontends

## Development

```bash
# Prerequisites: Node >=20, pnpm >=9

# Frontend
cd app && pnpm install && pnpm dev       # http://localhost:5173

# Backend
cd pocketbase && node start.js           # http://localhost:8090

# Proxy
cd proxy && pnpm install && pnpm dev     # Local wrangler

# Quality checks
cd app && pnpm check && pnpm test:run
```

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture Design](docs/IDEA.md) | Core philosophy, data flow, security model in depth |
| [Architecture Decision Records](docs/ADR.md) | Why things are the way they are |
| [Data Schema](docs/schema.md) | Relationship model and storage patterns |
| [Frontend Guide](app/AGENTS.md) | Layering rules, conventions, pipeline details |
| [Backend Guide](pocketbase/AGENTS.md) | PocketBase schema, hooks, auth endpoints |
| [Proxy Guide](proxy/AGENTS.md) | Stateless relay rules and SSRF protection |

## License

[AGPL-3.0](LICENSE)
