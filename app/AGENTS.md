# KeiAI App — AGENTS.md

SvelteKit frontend with client-side E2EE. TypeScript strict, Svelte 5, Tailwind CSS, Tauri (desktop/mobile).

```bash
pnpm install && pnpm dev          # http://localhost:5173
pnpm check                        # Type-check (svelte-check) — run before commit
pnpm test:run                     # All tests once
pnpm format ./path/to/file.ts     # Format ONLY specific files — NEVER run pnpm format globally
```

---

## Architecture — Four-Layer Stack

```
UI (routes/, views/, components/)
 │  reads: readonly Svelte stores  │  calls: store action functions
 ▼
Stores (lib/stores/)
 │  state.ts: all writable store instances  │  domain files: action functions
 ▼
Services (lib/services/)
 │  static-method classes  │  encrypt/decrypt  │  CRUD  │  guards
 ▼
Adapters (lib/adapters/)
 │  interface + platform impl (Web: IndexedDB/localStorage, Tauri: SQLite/FS)
```

### Cross-Cutting Modules

These sit outside the four-layer stack and are importable from any layer:

```
lib/types/         Domain vocabulary (models/, errors.ts, refs.ts)
lib/utils/         Infrastructure utilities (cache.ts, defaults.ts, events.ts, id.ts, ordering.ts, stream.ts)
lib/llm/           LLM handler layer (OpenAI-compatible streaming, prompt building, tokenizer)
lib/tts/           TTS handler layer (OpenAI TTS, ElevenLabs — per-handler classes)
lib/embedding/     Embedding handler layer (OpenAI-compatible batch embedding)
lib/scripts/       Text transformation (regex-based, used by both UI and tasks)
lib/tasks/         Pipeline orchestration (chat task, future: translate, summarize)
```

### Dependency Direction — Strict Top-Down

```
UI → Stores → Services → Adapters → platform APIs
```

### Forbidden Imports

| From         | Cannot Import                   | Reason                                     |
| ------------ | ------------------------------- | ------------------------------------------ |
| Service      | Store                           | Services are UI-agnostic                   |
| Store        | another Store (except state.ts) | Circular imports                           |
| Adapter      | Service or Store                | Adapters know nothing about domain         |
| tasks/       | Svelte stores (writables)       | Pipeline reads stores, writes via actions  |
| llm/         | Services or Stores              | LLM layer is stateless — all data injected |
| UI component | localDB or adapter directly     | All data goes through Services             |

---

## Core Design Principles

### Zero-Knowledge Encryption

All user data is encrypted client-side (AES-256-GCM) before storage. The server sees only opaque blobs.

- Master key `M` lives in memory (`session.ts` module-level var) or as a **non-extractable** `CryptoKey` in IndexedDB
- Guest users hold an extractable key (wrappable on registration); registered users hold non-extractable (XSS protection)
- Always obtain credentials via `getActiveSession()` — never cache `masterKey` in component state or stores
- Fresh random IV per encryption (semantic security)

### Encrypt-Decrypt-Merge Cycle

Every service follows the same data lifecycle:

```
Read:  DB record → decrypt(M, blob) → JSON.parse → deepMerge(defaults, parsed) → domain object
Update: DeepPartial<T> → deepMerge(current, patch) → JSON.stringify → encrypt(M, json) → DB record
Write: JSON.stringify(full) → encrypt(M, json) → DB record → fire-and-forget sync push
```

- `deepMerge(defaults, stored)` on every read means new fields auto-populate without migration code.
- `DeepPartial<T>` allows safe, nested updates without restructuring the entire object.
- Arrays are **overwritten**, objects are **recursively merged**.

### Local-First, Sync-Later

- IndexedDB is the source of truth; PocketBase is the sync target
- Sync is fire-and-forget: `void DataSyncService.pushRecord(...)` — UI never waits
- Realtime subscriptions + 300s fallback poll + online/visibility listeners
- LWW (Last Write Wins) by `updatedAt` timestamp

### Summary/Data Split

Most entities have two tables: `*Summaries` (list view fields) and `*Data` (full detail).

- List operations decrypt only summaries (fast)
- Detail view decrypts data on demand
- Atomic writes when both change: `localDB.transaction([summaryTable, dataTable], 'readwrite', ...)`

### Relationship Model

- **1:N** — Parent blob holds `OrderedRef[]` of child IDs (parent owns ordering + folders)
- **N:M** — Consumer blob holds `ResourceRef[]` with per-context `enabled` flag
- **Exception**: Messages use `chatId` FK + `sortOrder` compound index (O(1) writes vs O(n) parent blob rewrites)
- Fractional indexing (`generateKeyBetween()`) for `sortOrder` — inserts anywhere without renumbering

---

## State Management

### Store Hierarchy

All writable stores are declared in `stores/state.ts`. Action functions live in per-domain files.

```
L0 (Global):     appSettings, activeUser, pbConnected
L1 (Workspace):  characters, personas, presets, modules, plugins
L2 (Character):  activeCharacter, chats, characterLorebooks, characterScripts
L3 (Chat):       activeChat, messages, chatLorebooks
Ephemeral:       chatTasks (Map<chatId, ChatTask>) — in stores/tasks/
```

- Leaving a level clears child stores and zeroes decrypted data from memory
- `stores/index.ts` re-exports all writables as `readonly()` — UI can subscribe but never `.set()`/`.update()`
- Action functions import writables directly from `state.ts`

### Derived Stores

`displayMessages`, `isLoggedIn`, `activeCharacterId`, `activeChatId`, `allLorebooks`, `allScripts`, `activePersona`, etc. — composed from base stores.

### Guard Pattern in Actions

```typescript
// Only update UI if the user is still viewing this context
if (get(activeChatId) !== chatId) return;
```

---

## Service Layer Conventions

Every service file follows this order:

```typescript
// 1. Imports

// ─── Domain Types ────────────────────────────────────────────────────
// Interfaces: *SummaryFields, *DataFields, *Detail

// ─── Defaults ─────────────────────────────────────────────────────────
// const default*Fields = { ... }  — base for deepMerge

// ─── Helpers ─────────────────────────────────────────────────────────
// Private decrypt* functions — never exported

// ─── Service ─────────────────────────────────────────────────────────
// export class *Service { static async method() { ... } }
```

- All methods are `static async`
- Start every method with `const { masterKey, userId } = getActiveSession()`
- Throw `AppError(code, message, cause?)` — never swallow errors
- Pass original `cause` when wrapping lower-level exceptions
- Sync push is always fire-and-forget: `void DataSyncService.pushRecord(...)`

### Ownership Guards

Guard functions in `services/content/guards.ts` validate cross-entity relationships:

```typescript
assertCharacterExists(characterId);
assertChatOwnedByCharacter(chatId, characterId);
assertLorebookOwnedBy(lorebookId, ownerId);
```

All throw `AppError('OWNERSHIP_VIOLATION' | 'NOT_FOUND')`.

---

## Error Handling Philosophy

| Layer   | Responsibility                                                                |
| ------- | ----------------------------------------------------------------------------- |
| Adapter | Throw raw/platform errors (DexieError, HttpError) — **pass-through** original |
| Service | **Catch** & **Translate** platform errors into `AppError` with domain codes   |
| Store   | **Propagate** service errors to caller — no internal try/catch                |
| UI      | Catch and display user-facing messages via `getErrorMessage(error)`           |
| Sync    | Fire-and-forget — errors logged, never surfaced to UI                         |

```typescript
// Error codes (types/errors.ts):
// NOT_FOUND, OWNERSHIP_VIOLATION, ENCRYPTION_FAILED, DB_WRITE_FAILED,
// SESSION_EXPIRED, NOT_AUTHENTICATED, INVALID_CREDENTIALS, ALREADY_REGISTERED,
// INVALID_INPUT, NETWORK_ERROR, STORAGE_ERROR, ...
```

---

## Naming Conventions

| Kind                  | Pattern                                              | Example                                         |
| --------------------- | ---------------------------------------------------- | ----------------------------------------------- |
| DB record type        | `*Record`                                            | `CharacterSummaryRecord`, `MessageRecord`       |
| Domain fields type    | `*SummaryFields` / `*DataFields`                     | `ChatSummaryFields`                             |
| Combined detail type  | `*Detail`                                            | `CharacterDetail`, `PresetDetail`               |
| Service class         | `*Service` (static)                                  | `CharacterService.list()`                       |
| Store action function | `verbNoun()`                                         | `loadCharacters()`, `selectChat()`              |
| Guard function        | `assert*()`                                          | `assertChatOwnedByCharacter()`                  |
| Error code            | `SCREAMING_SNAKE`                                    | `'ENCRYPTION_FAILED'`                           |
| Shared ref types      | `OrderedRef`, `ResourceRef`, `FolderDef`, `AssetRef` | in `types/refs.ts`                              |
| ID generation         | `generateId()`                                       | 15-char lowercase+digits, PocketBase-compatible |

---

## Logging Conventions

- 앱 코드에서는 `console.*`를 직접 호출하지 말고 `createLogger(namespace?)`를 사용한다.
- Namespace는 `domain:module[:detail]` 형식의 소문자 콜론 구분자를 사용한다.
  - 예: `sync:asset`, `adapter:http:web`, `service:user:auth`
- Web 포맷: `[KeiAI][LEVEL][namespace?] message`
- Tauri 포맷: `[HH:mm:ss.SSS][LEVEL][namespace?] message` (일 단위 파일, 7일 보관)
- Logger 메서드 인자는 문자열 + payload 인자를 함께 전달해 디버깅 컨텍스트를 유지한다.

---

## Import Conventions

```typescript
// ✅ Barrel imports from directory
import { CharacterService, type CharacterDetail } from '$lib/services';
import { activeCharacter, loadCharacters } from '$lib/stores';

// ✅ Cross-cutting modules by path
import type { LLMModel, ModelConfig } from '$lib/types/models';
import { AppError } from '$lib/types/errors';
import { generateId } from '$lib/utils/id';

// ✅ Relative paths within same module
import { deepMerge } from '../utils/defaults';

// ❌ Direct file import (bypass barrel)
import { CharacterService } from '$lib/services/content/character';

// ❌ Extension in import
import { deepMerge } from '../utils/defaults.js';
```

Every layer has an `index.ts` barrel. Import from the barrel, not individual files.

---

## Code Style

### Section Separators

```typescript
// ─── Section Name ────────────────────────────────────────────────────
```

### TypeScript

```typescript
// Data shapes → interface
export interface CharacterSummaryFields { name: string; shortDescription: string; }

// Unions, aliases → type
export type ErrorCode = 'NOT_FOUND' | 'ENCRYPTION_FAILED';

// Optional (not set) vs Nullable (explicitly empty)
field?: string;       // undefined = not set
field: string | null; // null = explicitly empty
```

- **No `any`** — use `unknown` and narrow
- Strict mode enabled

### Svelte 5 Runes

```svelte
let value = $state('');
let computed = $derived(expression);
let { prop } = $props();
$effect(() => { ... });
```

### UI Stack

- **shadcn-svelte** — structural UI components (button, card, dialog, input, etc.)
- **bits-ui** — headless primitives underneath shadcn-svelte
- **lucide-svelte** — icons (import only what you use)
- **Tailwind CSS v4** — utility-first styling, OKLch color tokens, light/dark mode
- **tailwind-variants** — component variant composition

---

## Adapter Pattern

Ten adapter interfaces, each with Web + Tauri implementations dispatched via `isTauri()`:

| Adapter        | Web                  | Tauri                    | Purpose                           |
| -------------- | -------------------- | ------------------------ | --------------------------------- |
| `db`           | Dexie (IndexedDB)    | SQLite                   | Encrypted record storage          |
| `kv`           | localStorage         | @tauri-apps/plugin-store | Site preferences, sync timestamps |
| `storage`      | OPFS                 | Native FS                | Binary asset files                |
| `user`         | IndexedDB (separate) | Keychain + IndexedDB     | User records + CryptoKey          |
| `http`         | fetch                | @tauri-apps/plugin-http  | Cross-platform HTTP (CORS bypass) |
| `clipboard`    | Clipboard API        | Plugin                   | Text/image clipboard              |
| `dialog`       | Browser prompt       | Native dialog            | File open/save, confirmations     |
| `notification` | Notification API     | Plugin                   | OS notifications                  |
| `window`       | N/A                  | Plugin                   | Window management (Tauri-only)    |
| `logger`       | Console formatter    | File logger              | Structured app logging            |

### Adding a New Adapter

1. Define the interface in `adapters/<name>/types.ts`
2. Implement Web variant in `web.ts`, Tauri variant in `tauri.ts`
3. Export from `adapters/<name>/index.ts` with runtime dispatch
4. Re-export from `adapters/index.ts` barrel
5. Consume only from Services — never from UI

---

## Generation Pipeline

`lib/tasks/chat.ts` orchestrates LLM streaming:

1. Snapshot all context at call time (character, preset, lorebooks, scripts, messages) — isolated from UI switches
2. Build prompt from template order (`llm/prompt/builder.ts` — pure function)
3. Apply request-placement scripts
4. Resolve model: `preset.data.chatModel` → `LLMModelConfig` → find `LLMModel` → resolve connection
5. Create `LLMStreamHandler` via `selectLLMHandler(modelConfig, settings)` (`llm/handler.ts`)
6. Open ephemeral `ChatTask` in store (streaming bubble in UI)
7. Stream chunks from `LLMStreamHandler`, apply output scripts per-chunk
8. On success: `createMessage()` → persist → `clearChatTask()`
9. On abort: optionally save partial → `clearChatTask()`
10. On error: `setChatTaskError()` — bubble stays for user to dismiss

### Provider-Handler Architecture — "같은 인터페이스 = 같은 클래스"

Three protocol layers share a common selection pattern: `selectXXXHandler(modelConfig, settings)`

| Layer            | Input          | Output                            | Class Dispatch                                             |
| ---------------- | -------------- | --------------------------------- | ---------------------------------------------------------- |
| `lib/llm/`       | `OpenAIChat[]` | `AsyncIterable<LLMStreamContent>` | Handler-based (`openai_compatible`, `anthropic`, `google`) |
| `lib/tts/`       | `text`         | `AsyncIterable<TTSStreamChunk>`   | Handler-based (`openai`, `elevenlabs`, `google`)           |
| `lib/embedding/` | `text[]`       | `Promise<EmbeddingResult>`        | Handler-based (`openai_compatible`, `google`)              |

- **Handler-based** (LLM, Embedding): Multiple providers share one class when they use the same wire protocol (e.g. OpenAI-compatible handler). URL + API key swap only.
- **Handler-based** (TTS): Each handler has a distinct class because API handlers are incompatible.
- **Local models**: Dispatch by runtime (`onnx`, `llama_cpp`). One class per runtime, multiple models.
- See [ADR 021](../docs/ADR.md) for full rationale.

### Model System

Models are defined in `types/models/llm.ts` (LLM), `types/models/tts.ts` (TTS), `types/models/embedding.ts` (Embedding).
Two kinds via discriminated union:

- **Built-in** (`BuiltInLLMModel`): Hard-coded catalog, `provider` routes to `settings.apiKeys[provider]` + default base URL
- **Custom** (`CustomLLMModel`): User-defined in `settings.customModels[]`, owns `baseUrl` + `apiKey` directly

ID convention: `provider::modelId` for built-in (e.g. `openai::gpt-5.4`), `custom::nanoid` for custom.

`LLMModelConfig` (stored in presets) references a model by `{id, provider, parameters}`.

### LLMStreamHandler Architecture

`LLMStreamHandler` is an interface with a single method: `stream(messages, signal): AsyncIterable<LLMStreamContent>`.

- `LLMModel.handler` determines which `LLMStreamHandler` class to use (e.g. `openai_compatible` → `OpenAILLMStreamHandler`)
- Handlers are **stateless** — all config (apiKey, baseUrl, modelId, params, capabilities) is injected via constructor
- Handlers must **never** import Services, Stores, or Settings directly
- `selectLLMHandler()` is the single factory: resolves model → connection → instantiates the correct handler class

### Key Design Rules

- **No `any` in pipeline** — all data is typed end-to-end
- **Data snapshot at top** — `runChat()` loads everything before streaming starts (no mid-generation inconsistency)
- **Pure functions** — `buildPrompt()` and `selectLLMHandler()` are synchronous, no side effects
- **Tasks keyed by chatId** — survive context switches, user can navigate away during generation

---

## Adding a New Entity Type

Follow the existing Summary/Data split pattern:

1. **Schema**: Add PocketBase collection in `pocketbase/pb_migrations/` (encrypted table with `userId` FK + `cascadeDelete`)
2. **Adapter**: Add record types in `adapters/db/types.ts`, add table to Dexie schema in `db/web.ts`
3. **Service**: Create `services/content/<entity>.ts` — domain types, defaults, decrypt helpers, static CRUD class
4. **Shared**: Add `OrderedRef[]` to parent's data fields for 1:N, or `ResourceRef[]` for N:M
5. **Store**: Add writable in `stores/state.ts`, create `stores/content/<entity>.ts` with action functions
6. **Sync**: Register table in sync manager
7. **Export**: Add to relevant barrel files
8. **Test**: Write unit tests for service + store covering success, not-found, and encryption failure paths

---

## Development Workflow

```bash
pnpm dev              # Start dev server
pnpm check            # Type-check (run periodically + before commit)
pnpm test             # Watch mode
pnpm test:run         # All tests once
pnpm test:coverage    # Coverage report
pnpm format           # Format files
pnpm lint             # ESLint + Prettier check
```

**Cycle**: Write module → Write tests → Pass tests → `pnpm check` → `pnpm format <files>` → Commit.

---

## See Also

- [TESTING.md](TESTING.md) — Test infrastructure, mocking patterns, coverage goals
- [../pocketbase/AGENTS.md](../pocketbase/AGENTS.md) — Backend schema, hooks, E2EE auth endpoints
- [../proxy/AGENTS.md](../proxy/AGENTS.md) — Stateless proxy rules
- [../docs/IDEA.md](../docs/IDEA.md) — Comprehensive architecture design document
- [../docs/ADR.md](../docs/ADR.md) — Architecture decision records
- [../docs/schema.md](../docs/schema.md) — Data schema philosophy
- [../docs/asset-system-v2.md](../docs/asset-system-v2.md) — Asset system specification
