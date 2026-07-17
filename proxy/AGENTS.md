# Proxy — AGENTS.md

Stateless Cloudflare Worker that forwards HTTP requests. No logging, no storage, no state.

```bash
pnpm install && pnpm dev     # Local wrangler dev server
pnpm deploy                  # Deploy to Cloudflare
pnpm test                    # Vitest with cloudflare vitest-pool-workers
```

---

## Purpose

Generic HTTP proxy that forwards any fetch request to a target URL. Originally designed for AI API requests (OpenAI, Anthropic, etc.) to bypass CORS restrictions, but now supports arbitrary HTTP forwarding.

**Why a proxy?** Browser-to-API requests often face CORS restrictions. The proxy code is open source so users can verify it doesn't snoop.

---

## Inviolable Rules

| The proxy NEVER...             | Why                                            |
| ------------------------------ | ---------------------------------------------- |
| Stores API keys or data        | User privacy — everything is pass-through only |
| Logs requests or responses     | Zero traceability by design                    |
| Connects to any database       | Must remain fully stateless                    |
| Modifies request/response body | Transparency — what goes in comes out          |
| Stores any data                | Ephemeral-only, no persistence of any kind     |
| Inspects or parses content     | Not the proxy's concern                        |

Any new feature must pass this test: **"Does this require state or inspection?"** If yes, it doesn't belong here.

---

## Architecture

```
Client Request → POST /proxy
    ↓ (Headers: x-target-url, x-target-headers, x-target-method)
[Cloudflare Worker] — forward request as-is
    ↓
[Target URL] — response streams back (with CORS headers)
    ↓
[Client receives response]
```

No database. No logging. No state. Just HTTP forwarding with CORS headers.

---

## Endpoints

### `/health`

Health check endpoint. Returns `200 OK`.

### `/spec`

Protocol discovery endpoint used before saving a custom proxy connection.

```json
{
	"service": "keiai-proxy",
	"protocolVersion": 1,
	"capabilities": ["generic-fetch", "streaming"]
}
```

### `/proxy`

Generic proxy endpoint. Accepts POST requests with the following headers:

| Header             | Required | Description                              |
| ------------------ | -------- | ---------------------------------------- |
| `x-target-url`     | Yes      | Target URL to forward the request to     |
| `x-target-method`  | No       | HTTP method for target (default: `POST`) |
| `x-target-headers` | No       | JSON-encoded headers to forward          |

**Request Format:**

```typescript
const response = await fetch('/proxy', {
	method: 'POST',
	headers: {
		'x-target-url': 'https://api.example.com/endpoint',
		'x-target-method': 'POST',
		'x-target-headers': encodeURIComponent(
			JSON.stringify({
				Authorization: 'Bearer xxx',
				'Content-Type': 'application/json',
			}),
		),
	},
	body: JSON.stringify({ data: '...' }),
});
```

**Response:** The target server's response with CORS headers added.

---

## Development

### Tech Stack

- **Runtime**: Cloudflare Workers (V8 isolates)
- **Config**: `wrangler.jsonc` (compatibility date: 2026-02-24, `nodejs_compat` flag)
- **Testing**: Vitest with `@cloudflare/vitest-pool-workers` (runs tests in Workers runtime)
- **Types**: `wrangler types` generates `Env` interface from bindings

### Current State

✅ **Implemented** — Generic fetch proxy with:

- Single `/proxy` endpoint for all HTTP forwarding
- Header-based target specification (RisuAI-style pattern)
- CORS support (preflight + response headers)
- Health check endpoint
- Protocol discovery endpoint
- CORS headers on success and error responses
- Streaming support (body pass-through)

### Testing

```bash
npm test          # Runs vitest with cloudflare pool
npm test -- --watch   # Watch mode
```

Tests run inside the Cloudflare Workers runtime (not Node.js), so they accurately reflect production behavior.

---

## Deployment

```bash
npm deploy        # Deploy via wrangler to your Cloudflare account
```

Users can also deploy to their own Cloudflare account.

---

## See Also

- [app/AGENTS.md](../app/AGENTS.md) — Frontend that consumes this proxy
- [../AGENTS.md](../AGENTS.md) — Root project agents guide
