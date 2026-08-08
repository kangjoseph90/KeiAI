# KeiAI Frontend

`app/` contains the Svelte client, domain logic, local storage, encryption, sync, and Web/Tauri integrations.

## Commands

```bash
pnpm dev
pnpm check
pnpm test:run
pnpm lint
```

## Architecture

| Layer    | Responsibility                                                   |
| -------- | ---------------------------------------------------------------- |
| UI       | Render state and dispatch user intent                            |
| Managers | Coordinate use cases spanning multiple Stores or Services        |
| Stores   | Hold UI state and expose domain actions                          |
| Services | Own domain rules, scope checks, persistence, and sync boundaries |
| Adapters | Implement platform and persistence I/O                           |

```text
UI -> Store -> Service -> Adapter
UI -> Manager -> Stores and Services
UI -> Task -> WorkflowRuntime
```

Use the lowest layer that owns the operation. A single-domain action does not need a Manager; cross-domain orchestration does.

- UI may call Store, Manager, and Task APIs but must not access writable state or persistence adapters.
- Managers coordinate existing Store and Service APIs. They own neither state nor domain rules.
- Stores may call Services but must not import other Stores or Managers.
- Services must not import Stores, Managers, or UI.
- Adapters must not contain domain decisions or import higher layers.
- Model and inference handlers are stateless and receive their runtime context explicitly.

## Tasks and workflows

A Task is the top-level execution unit for a long-running application operation. It owns context loading, cancellation, transient UI state, persistence, and finalization.

A Workflow is the execution graph inside a Task. Workflow nodes compute or call handlers; they do not own application lifecycle or persistent state.

## Data

- Local domain records are plaintext. Sync encrypts records at the remote boundary.
- Sync uses independent cursors: remote pulls advance on server-owned `serverUpdatedAt`, while local pushes advance on replica-owned logical `updatedAt`.
- Sync cursors are structured local database records. Never encode cursor identity into key-value storage keys.
- Every syncable record has an explicit user or room scope, and Services validate that scope on access.
- The local database is authoritative; remote sync must not block local behavior.
- Each entity uses one domain record. Keep inseparable child data inline and reference independently stored entities. Messages remain separate because of their write volume.
- Reconstruct stored values with `deepMerge(defaults, stored)`. Objects merge recursively, arrays replace, and `undefined` removes a key.
- A room session extends the active user session rather than replacing it.

## State and I/O

- Declare writable Svelte stores in `stores/state.ts` and expose readonly state to UI code.
- Components must not receive state or callbacks that are merely lifted from their domain; pass entity data the parent already naturally owns, call ID-based actions directly, and keep local UI state local.
- Clear child context when its parent context ends, and guard async updates when the active context can change.
- Notify sync after successful local writes; do not wait for the remote write.
- Keep Web/Tauri differences behind shared Adapter interfaces.
- Throw `AppError` at application boundaries and retain the original cause when wrapping failures.

## Code

- Use TypeScript strict mode. Do not use `any`; narrow `unknown`.
- Put trusted metadata after spread data, for example `{ ...data, id }`.
- Use `interface` for object shapes and `type` for unions and aliases.
- Use public barrel exports across module boundaries unless doing so creates a cycle.
- Use `createLogger()` instead of `console.*` in application code.
- Use Svelte 5 runes for component-local state and derivation.
- Format only changed files.

Testing guidance lives in [`TESTING.md`](TESTING.md). The asset contract is documented in [`../docs/asset-system.md`](../docs/asset-system.md).
