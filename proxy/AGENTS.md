# Proxy — AGENTS.md

Stateless Cloudflare Worker that forwards AI API requests. No logging, no storage, no state.

```bash
pnpm install && pnpm dev     # Local wrangler dev server
pnpm deploy                  # Deploy to Cloudflare
pnpm test                    # Vitest with cloudflare vitest-pool-workers
```

---

## Purpose

Forward AI API requests (OpenAI, Anthropic, etc.) from the client to providers without exposing user API keys directly to browser CORS restrictions.

**Why a proxy?** Some users prefer not to expose API keys directly from the browser, and browser-to-AI-provider requests need CORS handling. The proxy code is open source so users can verify it doesn't snoop.

---

## Inviolable Rules

| The proxy NEVER...           | Why                                          |
| ---------------------------- | -------------------------------------------- |
| Stores API keys              | User privacy — keys are pass-through only    |
| Logs requests or responses   | Zero traceability by design                  |
| Connects to any database     | Must remain fully stateless                  |
| Modifies request/response body| Transparency — what goes in comes out       |
| Stores any data              | Ephemeral-only, no persistence of any kind   |
| Inspects or parses AI content| Not the proxy's concern                      |

Any new feature must pass this test: **"Does this require state or inspection?"** If yes, it doesn't belong here.

---

## Architecture

```
Client Request (with API key in header)
    ↓
[Cloudflare Worker] — read provider URL from env → forward as-is
    ↓
[AI Provider API] — response streams back
    ↓
[Client receives response]
```

No database. No logging. No state. Just HTTP forwarding with CORS headers.

---

## Planned Endpoints

### OpenAI-Compatible

```
POST /v1/chat/completions
POST /v1/completions
POST /v1/embeddings
```

### Anthropic

```
POST /v1/messages
```

### Configuration

Provider base URLs come from Cloudflare Worker environment bindings:

```
OPENAI_BASE_URL=https://api.openai.com/v1
ANTHROPIC_BASE_URL=https://api.anthropic.com/v1
```

Use `wrangler.jsonc` for local dev configuration, Cloudflare dashboard for production secrets.

---

## Development

### Tech Stack

- **Runtime**: Cloudflare Workers (V8 isolates)
- **Config**: `wrangler.jsonc` (compatibility date: 2026-02-24, `nodejs_compat` flag)
- **Testing**: Vitest with `@cloudflare/vitest-pool-workers` (runs tests in Workers runtime)
- **Types**: `wrangler types` generates `Env` interface from bindings → `worker-configuration.d.ts`

### Current State

The proxy is currently a stub (`Hello World!`). When implementing:

1. Parse the incoming request path to determine target provider
2. Read the provider base URL from `env` bindings
3. Forward the request headers and body as-is
4. Stream the response back to the client
5. Add CORS headers (`Access-Control-Allow-Origin`, etc.)
6. Handle preflight `OPTIONS` requests

### Testing

```bash
pnpm test          # Runs vitest with cloudflare pool
```

Tests run inside the Cloudflare Workers runtime (not Node.js), so they accurately reflect production behavior.

---

## Deployment

```bash
pnpm deploy        # Deploy via wrangler to your Cloudflare account
```

Users can also deploy to their own Cloudflare account (1-click deploy button in README).

---

## See Also

- [app/AGENTS.md](../app/AGENTS.md) — Frontend that consumes this proxy
- [notes/Idea.md](../notes/Idea.md) — Hybrid AI routing architecture (direct vs proxy)
