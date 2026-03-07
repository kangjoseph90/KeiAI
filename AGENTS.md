# KeiAI — Agent & Contributor Guidelines

This document is the authoritative reference for code style, architecture, and conventions in this codebase.
Read it before writing any code. Every section reflects decisions that are already baked into the existing code — not aspirational ideals, but real constraints.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Layer Rules & Dependency Direction](#2-layer-rules--dependency-direction)
3. [Adapter Pattern](#3-adapter-pattern)
4. [Service Layer](#4-service-layer)
5. [Store Layer](#5-store-layer)
6. [Shared Primitives](#6-shared-primitives)
7. [Naming Conventions](#7-naming-conventions)
8. [File & Module Structure](#8-file--module-structure)
9. [TypeScript Conventions](#9-typescript-conventions)
10. [UI Conventions](#10-ui-conventions)
11. [Comments & Documentation](#11-comments--documentation)
12. [Error Handling](#12-error-handling)
13. [Security Rules](#13-security-rules)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    UI Layer (Svelte)                        │
│          views/, components/, routes/+page.svelte          │
│  Reads: Svelte stores  |  Calls: store action functions    │
└─────────────────┬───────────────────────────────────────────┘
                  │ calls
┌─────────────────▼───────────────────────────────────────────┐
│                   Store Layer                               │
│               lib/stores/*.ts                              │
│  Owns: writable/derived store instances (state.ts)         │
│  Actions: per-domain files (character.ts, chat.ts, …)      │
└─────────────────┬───────────────────────────────────────────┘
                  │ calls
┌─────────────────▼───────────────────────────────────────────┐
│                 Service Layer                               │
│              lib/services/*.ts                             │
│  Domain logic, encryption/decryption, CRUD operations      │
│  Static method classes (CharacterService, ChatService, …)  │
└─────────────────┬───────────────────────────────────────────┘
                  │ calls
┌─────────────────▼───────────────────────────────────────────┐
│               Adapter Layer                                 │
│             lib/adapters/{db,kv,storage,user}/             │
│  Platform abstraction: Web (IndexedDB/LocalStorage)        │
│                        Tauri (native SQLite/FS)            │
└─────────────────────────────────────────────────────────────┘
```

**Supporting layers** (no layer restriction on who can call them):

| Layer                 | Path                        | Purpose                                                                  |
| --------------------- | --------------------------- | ------------------------------------------------------------------------ |
| `core/crypto/`        | Pure crypto toolkit         | Stateless. No DB, no session, no stores. Also exports `importMasterKey`  |
| `core/api/`           | PocketBase client + Sync    | Services call sync; stores never call sync directly                      |
| `services/session.ts` | In-memory session state     | Services call `getActiveSession()`; UI does not touch it directly        |
| `shared/`             | Domain types, errors, utils | Used by all layers                                                       |
| `generation/`         | LLM pipeline                | Stateless pipeline. Reads from Services; writes only to generation store |

---

## 2. Layer Rules & Dependency Direction

These rules are hard constraints. Violating them creates circular imports and architectural drift.

### Allowed call directions

```
UI → Stores → Services → Adapters
UI → Stores → Services → core/api/sync
                        ↑
                    services/session.ts (any layer may call getActiveSession)
                    shared/    (any layer may use)
                    core/crypto (any layer may call)
```

### Forbidden cross-layer calls

| ❌ Never do this                                          | Why                                                  |
| --------------------------------------------------------- | ---------------------------------------------------- |
| Store imports from another store file (except `state.ts`) | Causes circular imports                              |
| Service imports from a Store                              | Services must be UI-agnostic                         |
| Adapter imports from Service or Store                     | Adapters know nothing about domain                   |
| Sync layer imports from Stores                            | Keeps sync decoupled; callbacks are injected instead |
| `generation/pipeline.ts` reads from Svelte stores         | Pipeline must be isolated from UI context switches   |
| UI calls `localDB` or adapter directly                    | All DB access goes through the Service layer         |

All store instances are declared in `stores/state.ts`. Logic (action functions) is in the per-domain store files. This separation prevents circular imports across stores.

---

## 3. Adapter Pattern

Every platform-specific capability is hidden behind an interface. The rest of the app never knows which platform it's running on.

### Structure

```
adapters/
  db/
    types.ts      ← IDatabaseAdapter interface + all table/record types
    web.ts        ← Dexie (IndexedDB) implementation
    tauri.ts      ← Tauri SQLite implementation
    index.ts      ← export const localDB = isTauri() ? new TauriDatabaseAdapter() : new WebDatabaseAdapter()
  kv/             ← same pattern (localStorage vs Tauri Store)
  storage/        ← same pattern (File API vs Tauri FS)
  user/           ← same pattern (Dexie users table vs Tauri)
```

### Rules

- The interface lives in `types.ts` of the adapter directory. Both implementations must fully satisfy it.
- `index.ts` is the only place that does the `isTauri()` branch. All other code imports from `index.ts`.
- Never do `isTauri()` outside of an adapter `index.ts`.
- Add new tables / capabilities to `types.ts` first, then implement in both `web.ts` and `tauri.ts`.

---

## 4. Service Layer

Services are the heart of the business logic. They own encryption, decryption, and all DB writes.

### Structure within each service file

Every service file follows this exact section order:

```typescript
// 1. Imports

// ─── Domain Types ────────────────────────────────────────────────────
// Interfaces for the data fields this service manages
// (SummaryFields, DataFields, DataRefs, DataContent, the plain entity, the detail entity)

// ─── Defaults ─────────────────────────────────────────────────────────
// const default*Fields objects — used as the base for deepMerge on read

// ─── Helpers ─────────────────────────────────────────────────────────
// Private decrypt* functions — never exported

// ─── Service ─────────────────────────────────────────────────────────
// export class *Service { static async ... }
```

### Summary + Data split

Entities that need list previews are split into two DB records:

- `*SummaryRecord` — small, shown in lists (name, short description)
- `*DataRecord` — large, loaded only when entering the detail view

Both are `EncryptedRecord` with AES-GCM encrypted JSON blobs. The split is purely for read performance; they share the same `id`.

### Encryption pattern

```typescript
// Write: encrypt then store
const { ciphertext: encryptedData, iv: encryptedDataIV } = await encrypt(
  masterKey,
  JSON.stringify(fields),
);

// Read: decrypt then deepMerge with defaults
const dec = await decrypt(masterKey, {
  ciphertext: record.encryptedData,
  iv: record.encryptedDataIV,
});
const fields = deepMerge(defaultFields, JSON.parse(dec));
```

`deepMerge` is critical on read — it fills missing fields added in later schema versions, making migrations optional.

### Ownership & access guards

Use `guards.ts` for pre-condition assertions. Guards throw `AppError` with a typed code. Call them at the top of write operations before doing any DB mutation.

```typescript
// In guards.ts — always assert, never return boolean
export async function assertChatExists(chatId: string): Promise<void>;
export async function assertChatOwnedByCharacter(
  chatId: string,
  characterId: string,
): Promise<void>;
```

### Sync triggering

After every write (create / update / delete), call `DataSyncService.pushRecord(tableName, record)`. This is the only place sync is triggered. Services do not know about the sync internals.

---

## 5. Store Layer

Stores are the UI's reactive cache of service data.

### `stores/state.ts` — The only place stores are declared

All `writable()` and `derived()` calls live here, organized by context level:

```typescript
// Level 0 — Global (app settings, active user)
// Level 1 — Global lists (characters, personas, presets, modules, plugins)
// Level 2 — Character context (activeCharacter, chats, characterLorebooks, …)
// Level 3 — Chat context (activeChat, messages, chatLorebooks)
// Generation — Ephemeral UI state (generationTasks, isGenerating, displayMessages)
```

### Per-domain action files

`stores/character.ts`, `stores/chat.ts`, etc. contain **action functions** (not store declarations). They:

1. Call the service layer
2. Update the relevant stores
3. Handle derived state cleanup (e.g. `clearActiveChat()` when switching characters)

### Generation store

`generationTasks` is a `Map<chatId, GenerationTask>`. It is keyed by `chatId` so background generations survive UI navigation. The pipeline writes to it; the UI reads from `displayMessages` (a derived store that merges confirmed messages with the active task).

**Generation state is ephemeral — never persisted to DB.**

---

## 6. Shared Primitives

### `shared/types.ts`

Core structural types reused across domains. Do not add domain-specific types here.

| Type          | Purpose                                                                   |
| ------------- | ------------------------------------------------------------------------- |
| `OrderedRef`  | `{ id, sortOrder, folderId? }` — 1:N parent→child ordered list            |
| `ResourceRef` | Extends `OrderedRef` with `enabled: boolean` — N:M with per-context state |
| `FolderDef`   | Folder definition stored inside parent's encrypted blob                   |
| `AssetRef`    | `{ name, assetId }` — name-based asset resolution                         |

### `shared/ordering.ts`

Uses fractional indexing (the `fractional-indexing` package) for stable list ordering without renumbering. Never use integer positions.

```typescript
generateSortOrder(existingRefs); // append to end
sortByRefs(entities, refs); // sort entity array by their ref's sortOrder
```

### `shared/defaults.ts` — `deepMerge`

`deepMerge(base, overlay)` is used in two ways:

1. **Read path**: `deepMerge(defaultFields, JSON.parse(decrypted))` — fills missing keys from new schema fields
2. **Write path**: `deepMerge(currentData, partialUpdate)` — merges partial updates, preserving sibling keys

Arrays are **replaced, not merged**. Plain objects recurse. Everything else overlays.

### `shared/errors.ts`

```typescript
type ErrorCode =
  | "NOT_FOUND"
  | "OWNERSHIP_VIOLATION"
  | "ENCRYPTION_FAILED"
  | "DB_WRITE_FAILED"
  | "SESSION_EXPIRED";

throw new AppError("NOT_FOUND", `Character not found: ${characterId}`);
```

Always use `AppError` with a typed `ErrorCode`. Never throw raw strings or generic `Error` for domain failures. The code is machine-readable for UI error boundaries.

### `shared/id.ts`

`generateId()` produces 15-character lowercase alphanumeric IDs, compatible with PocketBase's ID format. Never use `crypto.randomUUID()` for entity IDs.

---

## 7. Naming Conventions

### Files

| Pattern            | Convention          | Example                                |
| ------------------ | ------------------- | -------------------------------------- |
| Svelte components  | `PascalCase.svelte` | `CharactersView.svelte`                |
| TypeScript modules | `camelCase.ts`      | `character.ts`, `ordering.ts`          |
| Adapter index      | `index.ts` (always) | `adapters/db/index.ts`                 |
| Barrel exports     | `index.ts`          | `services/index.ts`, `stores/index.ts` |

### Types & Interfaces

| Kind             | Convention               | Example                                    |
| ---------------- | ------------------------ | ------------------------------------------ |
| Domain interface | `PascalCase`             | `Character`, `ChatDetail`, `MessageFields` |
| DB record type   | `*Record` suffix         | `CharacterSummaryRecord`, `MessageRecord`  |
| Summary fields   | `*SummaryFields`         | `CharacterSummaryFields`                   |
| Data fields      | `*DataFields`            | `CharacterDataFields`                      |
| Data refs        | `*DataRefs`              | `CharacterDataRefs`                        |
| Data content     | `*DataContent`           | `CharacterDataContent`                     |
| Error codes      | `SCREAMING_SNAKE_CASE`   | `'NOT_FOUND'`, `'ENCRYPTION_FAILED'`       |
| Table names      | `camelCase` (pluralized) | `'characterSummaries'`, `'chatData'`       |

### Variables & Functions

| Kind                   | Convention                 | Example                                                         |
| ---------------------- | -------------------------- | --------------------------------------------------------------- |
| Store instances        | `camelCase` noun           | `activeCharacter`, `generationTasks`                            |
| Store action functions | `verb + noun`              | `loadCharacters()`, `selectCharacter()`, `clearActiveChat()`    |
| Service methods        | `verb + noun` static       | `CharacterService.list()`, `MessageService.getMessagesBefore()` |
| Guard functions        | `assert + *`               | `assertCharacterExists()`, `assertChatOwnedByCharacter()`       |
| Const defaults         | `default + *Fields/Data`   | `defaultSummaryFields`, `defaultDataFields`                     |
| Private helpers        | `camelCase` (not exported) | `decryptSummaryFields()`, `decryptDataFields()`                 |
| Adapter instances      | `app + *`                  | `appKV`, `appStorage`, `appUser`, `localDB`                     |

### Svelte components

- Props use `camelCase`; event handler props use `on + PascalCase` (e.g. `onNavigate`, `onDelete`, `onSave`).
- UI event handlers local to the component use `handle + PascalCase` (e.g. `handleSendMessage()`, `handleCreate()`).
- Local state variables: `camelCase` (e.g. `newMessageText`, `editModeId`).

---

## 8. File & Module Structure

### Barrel exports

Every layer has an `index.ts` that re-exports its public API. Outside code imports from the barrel, not from individual files.

```typescript
// ✅ Correct
import { CharacterService, type CharacterDetail } from "$lib/services";
import { activeCharacter, loadCharacters } from "$lib/stores";

// ❌ Wrong
import { CharacterService } from "$lib/services/character";
import { activeCharacter } from "$lib/stores/state";
```

### Import paths and conventions

- **Hybrid approach (`$lib` vs relative paths):**
  - Use relative paths (`./`, `../`) for imports within the same module/domain to indicate cohesion.
  - Use `$lib/...` aliases for imports across different domains or architectural layers (e.g., from `services` to `adapters`).
- **Barrel file imports:** When importing a directory's `index.ts` barrel file, import the directory name directly (e.g., `import { SyncManager } from './sync'`). Do not append `/index`.
- **File extensions:** Do NOT include `.js` or `.ts` extensions in import paths. Rely on the bundler's module resolution.

```typescript
// ✅ Correct
import { UserService } from "$lib/services/user/user"; // Cross-module
import { deepMerge } from "../shared/defaults"; // Relative, no extension
import { SyncManager } from "./sync"; // Directory import for index.ts

// ❌ Wrong
import { UserService } from "../../services/user/user"; // Relative cross-module
import { deepMerge } from "../shared/defaults.js"; // Has .js extension
import { SyncManager } from "./sync/index"; // Explicit index
```

### Section separators

Use the ASCII banner style for top-level section dividers inside files:

```typescript
// ─── Section Name ────────────────────────────────────────────────────
```

This is consistent throughout the codebase and makes file scanning fast.

---

## 9. TypeScript Conventions

### Type aliases for raw bytes

Declare `type Bytes = Uint8Array<ArrayBuffer>` locally in each file that works with binary data. Do not import it — it is a local annotation, not a shared contract.

### Prefer `interface` for data shapes, `type` for unions/aliases

```typescript
// ✅ Data shape → interface
export interface CharacterSummaryFields { name: string; shortDescription: string; }

// ✅ Union or alias → type
export type ErrorCode = 'NOT_FOUND' | 'ENCRYPTION_FAILED';
export type TableName = 'characterSummaries' | 'chatData' | ...;
export type GenerationStatus = 'generating' | 'error';
```

### Explicit `null` vs `undefined`

- Optional fields in stored data: `field?: Type` (undefined = not set)
- Nullable identity / "nothing loaded": `Type | null` (null = explicitly empty)
- Stores that represent "nothing selected": `writable<Entity | null>(null)`

### No `any`

Use `unknown` when the shape is truly unknown, then narrow with type guards. The only acceptable use of `as` is when TypeScript cannot infer what the code proves (e.g. `ArrayBuffer` → typed array casts from Web Crypto API).

### `satisfies` over casting

```typescript
// ✅ Preferred
export default { async fetch(...) { ... } } satisfies ExportedHandler<Env>;

// ❌ Avoid unless necessary
const x = something as SomeType;
```

---

## 10. UI Conventions

### Component library

- **shadcn-svelte** for all structural UI components (Button, Card, Input, ScrollArea, DropdownMenu, Avatar, …).
- Import from the component's barrel: `import { Button } from '$lib/components/ui/button'`.
- Never write raw `<button>` or `<input>` elements when a shadcn equivalent exists.

### Icons

- **lucide-svelte** exclusively. No other icon library.
- Import only the icons you use: `import { Plus, Trash2, Pencil } from 'lucide-svelte'`.
- Icon sizing: use `class="size-4"` (1rem) inside buttons.
- Icon + label buttons: `<Button class="gap-1.5"><Icon class="size-4" /> Label</Button>`.

### Styling

- **Tailwind CSS** utility classes only. No custom CSS except in `app.css` for global resets / CSS variables.
- Use design-system tokens (`bg-card`, `bg-accent`, `text-muted-foreground`, etc.) over raw colors.
- Layout gaps: `gap-2` (tight), `gap-3` (default list), `gap-4` (section), `gap-6` (panel split).
- Prefer `flex flex-col gap-*` over `space-y-*` for lists.

### Svelte 5 runes

This project uses Svelte 5 runes syntax throughout:

```typescript
let value = $state('');              // mutable local state
let derived = $derived(computation); // computed from other state
let { prop } = $props();             // component props
$effect(() => { ... });              // side effects
```

Do not use Svelte 4's `let` + `$: reactive` syntax anywhere.

### View components

Views live in `lib/views/`. Each maps to a top-level navigation destination. Views receive navigation context via props (e.g. `charId`, `chatId`) and trigger navigation through callback props (`onNavigate`). Views do not contain their own routing logic.

---

## 11. Comments & Documentation

### When to write a file-level docblock

Every non-trivial module gets a file-level comment that answers: _what does this module do, and what design decisions are baked in?_ Keep it concise — 3–10 lines.

```typescript
/**
 * Chat Pipeline — KeiAI
 *
 * runChat(chatId, provider) is the single entry point for a full AI response cycle.
 * Design: Stateless pipeline — snapshots all context from Services at call time.
 * Does NOT read from Svelte stores (stores are UI cache only).
 */
```

### When to write inline comments

Write a comment when the code implements a non-obvious decision, trade-off, or constraint that would take the next developer time to re-derive. Do not comment obvious code.

```typescript
// ✅ Explains WHY, not WHAT
// Lower iteration count is acceptable here because the recovery code
// has ~39 bits of entropy and the recovery endpoint is rate-limited.

// ❌ Narrates the obvious
// Iterate over the array
for (const item of items) { ... }
```

### TODO format

Mark incomplete work with structured TODOs:

```typescript
// ─── TODO: buildContext(chatId) ────────────────────────────────────
// Snapshot all needed data from Service Layer (NOT from stores).
// const ctx = await buildContext(chatId);
```

For checklist-style progress in file headers use `✅` / `🔲`:

```
// ✅ Streaming lifecycle
// 🔲 TODO: PromptBuilder
```

### Section banners

Use the separator style consistently:

```typescript
// ─── Domain Types ────────────────────────────────────────────────────
// ─── Defaults ─────────────────────────────────────────────────────────
// ─── Helpers ─────────────────────────────────────────────────────────
// ─── Service ─────────────────────────────────────────────────────────
```

---

## 12. Error Handling

### Service layer — always throw `AppError`

```typescript
throw new AppError("NOT_FOUND", `Character not found: ${characterId}`);
throw new AppError(
  "OWNERSHIP_VIOLATION",
  `Chat ${chatId} does not belong to character ${characterId}`,
);
throw new AppError(
  "ENCRYPTION_FAILED",
  "Failed to decrypt character summary",
  cause,
);
```

Pass the original `cause` when wrapping a lower-level error (enables cause chain inspection in dev tools).

### Store layer — let service errors propagate

```typescript
/**
 * Service errors propagate to the caller — this function does not catch them.
 * Callers (e.g. route load functions) are responsible for error boundaries.
 */
export async function loadCharacters(): Promise<void> { ... }
```

Do not swallow errors in store actions unless you have a deliberate recovery strategy. Surface them to the UI.

### Async guard pattern

Use `assert*` functions (from `services/guards.ts`) for pre-condition checks, not ad-hoc `if (!x) return`. This keeps write operations from leaving the DB in a partial state when a parent doesn't exist.

---

## 13. Security Rules

### Zero-knowledge encryption

All user data in the DB is encrypted client-side with AES-256-GCM before storage. The server (PocketBase) only ever sees ciphertext. Never store plaintext sensitive data in `encryptedData` columns.

- The master key `M` lives in memory only (`session.ts` module-level variable).
- `M` is stored in IndexedDB as a non-extractable `CryptoKey` (for registered users) via the Structured Clone algorithm — raw bytes are never written to disk by the application.
- Guest users get an extractable key (so it can be wrapped when they register).

### Never bypass the session

```typescript
// ✅ Always go through getActiveSession()
const { masterKey, userId } = getActiveSession();

// ❌ Never cache masterKey in component state or pass it through stores
```

### Input validation at boundaries

Validate and sanitize at system entry points: user form input, external API responses, URL parameters parsed in `router.ts`. Trust internal service return values — they were constructed by this codebase.

### Crypto API rules

- Always use `crypto.getRandomValues()` for randomness. Never `Math.random()` for anything security-sensitive.
- Always use a fresh random IV per encryption. Never reuse an IV with the same key.
- Use `crypto.subtle` APIs only. Do not bring in third-party crypto libraries unless absolutely necessary and audited.

### Sync is blind

The sync layer (`core/api/sync/`) uploads and downloads encrypted records. It never decrypts them. Keep it that way — the sync layer must remain unable to read user data.
