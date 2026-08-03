# KeiAI Connection System

Connections select the sync server and Web request proxy used by one local user on one device. They are local runtime configuration and are never synchronized.

```ts
interface UserConnectionSettings {
  server: { mode: "default" | "custom"; customUrl?: string };
  proxy: { mode: "default" | "custom" | "off"; customUrl?: string };
}
```

Server and proxy settings share storage and activation but remain independent contracts.

## Runtime

Activating a user resolves their settings once and applies them to PocketBase and the HTTP adapter before authentication, sync, or network work begins.

- `default` server resolves to the build-configured PocketBase URL.
- `custom` server resolves to its saved URL.
- `default` proxy uses the build-configured proxy when present, otherwise direct requests.
- `custom` proxy uses its saved URL.
- `off` uses direct requests.
- Tauri always uses its native direct HTTP adapter because it is not subject to browser CORS.

Runtime identity is derived from the resolved destinations, not from the saved modes. This is what `isKeiServer()` and `isKeiProxy()` report.

## Compatibility

Custom connections are checked before they are saved:

| Service | Endpoint | Response |
| --- | --- | --- |
| Server | `GET /api/spec` | `{ app: "keiai", protocol: 1 }` |
| Proxy | `GET /spec` | `{ app: "keiai-proxy", protocol: 1 }` |

The response shape is shared; `app` distinguishes the two non-interchangeable services.

## Changes

A proxy change validates, persists, and applies the new HTTP runtime. Failure restores the previous setting and runtime; it never silently falls back to direct requests.

A server change must preserve assets that currently exist only on the old server. Before switching URLs, `ConnectionService` pauses sync and eviction, localizes remote user assets, persists the new setting, and restores any auth session stored for the destination server. Failure restores the previous asset status, setting, and runtime.

PocketBase auth tokens are stored by `userId × serverUrl`, so switching servers switches auth context without merging server sessions.

## Invariants

- UI and request handlers do not resolve connection URLs themselves.
- Network hot paths use the applied runtime snapshot rather than reading local storage.
- A user is never activated with the previous user's connection runtime.
- Changing a connection does not create an account or authenticate the destination.
- Server transition failure preserves the previous server and local access to its assets.
- Custom proxy failure does not change request routing.
