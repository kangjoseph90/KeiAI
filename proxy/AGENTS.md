# KeiAI Proxy Guide

`proxy/` is a stateless Cloudflare Worker that forwards HTTP requests for the client.

## Commands

```bash
pnpm dev
pnpm test
pnpm cf-typegen
```

## Invariants

- Do not store request data, response data, credentials, or user state.
- Do not log or inspect request and response content.
- Do not add databases, durable state, analytics, or content-dependent behavior.
- Preserve the target response status, headers, and streaming body except for required CORS headers.
- Treat target URLs and target headers as untrusted input.
- Keep provider-specific logic in the client; the proxy remains protocol-agnostic.

## External contract

| Endpoint | Contract |
| --- | --- |
| `GET /health` | Basic availability check |
| `GET /spec` | Proxy identity and protocol discovery |
| `POST /proxy` | Forward a request to the supplied target |

`POST /proxy` accepts these control headers:

| Header | Requirement |
| --- | --- |
| `x-target-url` | Required target URL |
| `x-target-method` | Optional target method; defaults to `POST` |
| `x-target-headers` | Optional encoded JSON object containing target headers |

The request body is forwarded as a stream. The target response is returned as a stream with CORS headers added. Changes to this contract require matching client and protocol-version changes.

`ALLOWED_ORIGINS` controls accepted browser origins. CORS headers must be present on preflight, success, and error responses.

## Security

- Validate every target before forwarding it.
- Allow only HTTP and HTTPS targets.
- Block loopback, private, link-local, metadata-service, and other internal destinations.
- Do not weaken target validation to support a provider or development environment.
- Do not expose credentials or upstream response content in proxy-generated errors.

Any target-validation change requires tests for allowed public targets and blocked internal targets. CORS changes require tests for configured and unconfigured origins.

## Development rules

- Run tests in the Cloudflare Workers test pool rather than assuming Node.js behavior.
- Test forwarding without making tests depend on live third-party services.
- Keep request and response bodies unbuffered unless a protocol requirement makes buffering unavoidable.
- Do not edit generated Worker type declarations manually; regenerate them with `pnpm cf-typegen`.
