# Service Layer

Stateless, static-class wrappers around IndexedDB + client-side encryption.
Each service owns one entity type's CRUD operations — no cross-entity orchestration.

## Responsibilities

- **Encrypt on write**, decrypt on read (via `session.ts` master key)
- **Apply defaults** at read time (`deepMerge`) for forward-compatible schema evolution
- **Deep-merge updates** — `deepMerge(current, changes)` preserves sibling keys in nested objects
- **Validate ownership** where applicable (via `guards.ts`)
- **Transact** across split tables (summary + data) atomically
- **Cascade soft-delete** for parent → child relationships

## Entity Categories

### Split-table (Summary + Data)

| Service               | Tables                                       |
| --------------------- | -------------------------------------------- |
| `CharacterService`    | `characterSummaries` + `characterData`       |
| `ChatService`         | `chatSummaries` + `chatData`                 |
| `PromptPresetService` | `promptPresetSummaries` + `promptPresetData` |

API: `list()`, `getDetail()`, `create()`, `updateSummary()`, `updateData()`, `update()`, `delete()`.

### Single-table

| Service           | Table       |
| ----------------- | ----------- |
| `ModuleService`   | `modules`   |
| `PersonaService`  | `personas`  |
| `PluginService`   | `plugins`   |
| `LorebookService` | `lorebooks` |
| `ScriptService`   | `scripts`   |
| `MessageService`  | `messages`  |

API: `list()`/`listByOwner()`, `get()`, `create()`, `update()`, `delete()`.

### Special

- **`SettingsService`** — Singleton per user. `get()`, `set()`, `update()`.
- **`AssetService`** — Content-hash dedup. No encryption.

## Type Pattern: `Content + Refs = Fields`

- **Content** — user-editable text, safe for store-layer public API
- **Refs** — structural references (`OrderedRef[]`, `FolderDef[]`), managed by store orchestration
- **Fields** = Content ∪ Refs — full encrypted blob

## Update Semantics

All `update()` methods use `deepMerge(current, changes)`:

- Plain objects → recursively merged (preserves sibling keys)
- Arrays → replaced entirely
- Primitives → overwritten

## Error Handling

- Record not found → return `null`
- Ownership violation → `throw Error`
- Encryption failure → propagates
