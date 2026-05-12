# KeiAI App — AGENTS.md

Svelte frontend with local plaintext storage and encrypted cloud sync. TypeScript strict, Svelte 5, Tailwind CSS, Tauri (desktop/mobile).

```bash
pnpm install && pnpm dev          # http://localhost:5173
pnpm check                        # Type-check (svelte-check) — run before commit
pnpm test:run                     # All tests once
pnpm format ./path/to/file.ts     # Format ONLY specific files — NEVER run pnpm format globally
```

---

## Architecture — Four-Layer Stack

```
UI (views/, components/)
 │  reads: readonly Svelte stores  │  calls: store action functions
 ▼
Stores (lib/stores/)
 │  state.ts: all writable store instances  │  domain files: action functions
 ▼
Services (lib/services/)
 │  static-method classes  │  CRUD  │  sync encryption  │  guards
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

### Local Plaintext, Encrypted Sync

Local storage is plaintext domain JSON. Synced data is encrypted client-side (AES-256-GCM) before leaving the browser, so the server sees only opaque blobs.

- Master key `M` is generated with the local identity and remains extractable for sync wrapping, recovery, and device transfer
- Local-only vs sync-linked state is derived from `UserRecord.username` and PocketBase auth validity. `syncServerUrl` is only the selected sync server setting, not the link state.
- Use `getActiveSession()` for local identity; use `getSyncSession()` only at sync/encryption boundaries
- Fresh random IV per encryption (semantic security)

### Encrypt-Decrypt-Merge Cycle

Every service follows the same data lifecycle:

```
Read:  DB record.data → deepMerge(defaults, data) → domain object
Update: DeepPartial<T> → deepMerge(current, patch) → plaintext DB record
Sync:  plaintext DB record ↔ encrypt/decrypt(M) ↔ PocketBase encrypted blob
```

- `deepMerge(defaults, stored)` on every read means new fields auto-populate without migration code.
- `DeepPartial<T>` allows safe, nested updates without restructuring the entire object.
- Arrays are **overwritten**, objects are **recursively merged**, `undefined` values **delete keys**.

### Local-First, Sync-Later

- IndexedDB is the source of truth; PocketBase is the sync target
- Sync is fire-and-forget: `void DataSyncService.pushRecord(...)` — UI never waits
- Realtime subscriptions + 300s fallback poll + online/visibility listeners
- LWW (Last Write Wins) by `updatedAt` timestamp

### Single-Table Pattern

Each entity type uses one table with one local plaintext `data` payload. The same payload is encrypted only when synchronized to PocketBase.

- Every entity is stored in a single table (e.g., `characters`, `chats`, `presets`)
- No split between summary and data tables — one record, one payload
- `XxxContent` holds user-editable fields; `XxxRefs` holds structural references

### Relationship Model

- **1:N** — Parent blob holds `EntityListConfig` (`Record<string, OrderedRef>`) of child IDs (parent owns ordering + folders)
- **N:M** — Consumer blob holds `EntityListConfig<ResourceRef>` with per-context `enabled` flag
- **Exception**: Messages use `chatId` FK + `sortOrder` compound index (O(1) writes vs O(n) parent blob rewrites)
- PocketBase uses no FK relations for domain records; local adapters keep only the indexes the app needs
- Fractional indexing (`generateKeyBetween()`) for `sortOrder` — inserts anywhere without renumbering

---

## State Management

### Store Hierarchy

All writable stores are declared in `stores/state.ts`. Action functions live in per-domain files.

```
L0 (Global):     appSettings, activeUser, pbConnected
L1 (Workspace):  characters, personas, presets, modules, plugins
L2 (Room):       activeRoom, roomCharacters, chats
L3 (Chat):       activeChat, messages, chatLorebooks, chatPersonas
Studio:          activeCharacter, characterLorebooks, characterScripts, characterCharJS, characterModules
Studio:          activeModule, moduleLorebooks, moduleScripts, moduleCharJS
Task:            chatTasks (Map<chatId, ChatTask>) — execution state (status, error) in stores/tasks/
```

- Leaving a level clears child stores and drops plaintext UI state from memory.
- Character/Module studio state is independent of the active room/chat route. Opening a studio loads only that resource and its owned resources.
- `stores/index.ts` re-exports all writables as `readonly()` — UI can subscribe but never `.set()`/`.update()`
- Action functions import writables directly from `state.ts`

### Derived Stores

`displayMessages`, `isLoggedIn`, `activeRoomId`, `activeChatId`, `activeCharacterId`, `activeModuleId`, `allLorebooks`, `allScripts`, etc. — composed from base stores.

There is no global `activePersona`. Persona participation and runtime selection live on the chat record (`chat.personas`, `selectedPersonaId`, `defaultPersonaId`).

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
// Interfaces: *Content, *Refs, *Fields, *

// ─── Defaults ─────────────────────────────────────────────────────────
// const default*Fields = { ... }  — base for deepMerge

// ─── Helpers ─────────────────────────────────────────────────────────
// Private parse* helpers — never exported

// ─── Service ─────────────────────────────────────────────────────────
// export class *Service { static async method() { ... } }
```

- All methods are `static async`
- Start every method with `const { masterKey, userId } = getActiveSession()`
- Throw `AppError(code, message, cause?)` — never swallow errors
- Pass original `cause` when wrapping lower-level exceptions
- Sync push is always fire-and-forget: `void DataSyncService.pushRecord(...)`

### Ownership Guards

Weak refs are validated at the store/task boundary rather than by server FK:

- `Room -> Character`: room character ref must exist and be enabled for selection/execution.
- `Chat -> Persona`: chat persona ref must exist and be enabled for user messages.
- Message swipe `speakerId/speakerName` is historical display data; do not self-heal or delete it.

---

## Naming Conventions

| Kind                  | Pattern                                              | Example                                         |
| --------------------- | ---------------------------------------------------- | ----------------------------------------------- |
| DB record type        | `*Record`                                            | `CharacterRecord`, `MessageRecord`              |
| Domain fields type    | `*Fields`                                            | `ChatFields`, `CharacterFields`                 |
| Combined domain type  | `*`                                                  | `Character`, `Preset`                           |
| Service class         | `*Service` (static)                                  | `CharacterService.list()`                       |
| Store action function | `verbNoun()`                                         | `loadCharacters()`, `selectChat()`              |
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
import { CharacterService, type Character } from '$lib/services';
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
export interface CharacterContent { name: string; shortDescription: string; }

// Unions, aliases → type
export type ErrorCode = 'NOT_FOUND' | 'ENCRYPTION_FAILED';

// Optional (not set) vs Nullable (explicitly empty)
field?: string;       // undefined = not set
field: string | null; // null = explicitly empty
```

- **No `any`** — use `unknown` and narrow
- **Defensive spread order**: Always put metadata _after_ spreads (e.g., `{ ...data, id }`) to prevent identity overwrites.
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

`lib/tasks/chat/index.ts` orchestrates LLM streaming. Messages are persisted to DB immediately on creation; the ChatTask is a thin state tracker that holds no content.

Pipeline steps:

1. Guard: prevent duplicate runs per chatId
2. Load chat + settings, then room.
3. Resolve runtime ids from the chat record:
    - character: `selectedCharacterId ?? defaultCharacterId`
    - persona: `selectedPersonaId ?? defaultPersonaId`
4. Validate that the character ref exists/enabled in the room and the persona ref exists/enabled in the chat.
5. `createMessage()` — empty assistant message in DB (unless reroll).
6. Create a `PagedMessages` view before the target message.
7. Load character, preset, persona, and lorebooks for the resolved context.
8. Setup variables with `getChatVariablesBefore(chatId, targetMessage.sortOrder)`.
9. `prepareNextSwipe()` — create active swipe with `speakerId`, `speakerName`, and variables.
10. Register ChatTask (messageId + AbortController).
11. `buildPrompt()` — async pure prompt assembly over `PagedMessages`.
12. Apply prompt-phase pipeline handlers with the resolved `TemplateContext`.
13. `selectLLMHandler()` → stream chunks.
14. Per chunk: `updateMessageSwipe()` with streamed content/thought.
15. Final output pass: `runTemplate()` → output pipeline → `runTemplate()` → `updateMessageSwipe()`.
16. Finalize: validate non-empty → `clearChatTask()`.
17. On abort: `clearChatTask()` (content already in DB).
18. On error: `setChatTaskError()` — error overlay stays for user to dismiss.

### ChatTask

Execution UI state keyed by chatId. Fields: `status` (generating | error), `messageId`, `controller` (AbortController), `errorMessage?`.

The `displayMessages` derived store overlays task status (e.g. showing a loading indicator) onto existing DB messages. Content is read directly from the DB messages store as it is updated in real-time. No virtual messages or virtual swipes are generated.

### Variable System

Variables are stored per swipe as `Record<string, string>` to support snapshot. A new swipe starts from:

1. room enabled characters' `defaultVariables`, merged in `room.characters.refs` sort order
2. previous active swipe variables, if applicable

Use `getChatDefaultVariables()`, `getChatVariables()`, and `getChatVariablesBefore()` from `lib/managers/chat.ts`.

The CharJS sandbox exposes `KeiAPI.getVar(key)` / `KeiAPI.setVar(key, value)`, which read and write from the last message's active swipe.

### Prompt, Template, and Pipeline Context

All prompt/template/pipeline execution uses `TemplateContext`. The default philosophy is "use the most specific context available."

| Scope                   | Context rule                                                                    |
| ----------------------- | ------------------------------------------------------------------------------- |
| User input              | default character + selected persona                                            |
| `runChat` prompt/output | selected/default character + selected/default persona                           |
| Assistant display       | active swipe `speakerId` as character when present, otherwise default character |
| User display            | active swipe `speakerId` as persona when present, otherwise default persona     |
| History block           | per-message context from active swipe `role + speakerId + speakerName`          |

`runPipeline(chatId, phase, data, ctx)` collects handlers internally from `ctx.characterId`. Lower-level collect functions may accept an explicit `characterId` for callers that need collection without execution.

### Greeting System

`syncChatGreetings(chatId)` keeps one assistant greeting message per chat.

- `chat.greetingMessageId` points to the greeting message.
- Each enabled room character greeting becomes one swipe in that message.
- Greeting swipe id is the character greeting id.
- Greeting swipes store `speakerId`, `speakerName`, and seeded variables.

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
- **Pure boundaries** — `buildPrompt()` is async but side-effect free; `selectLLMHandler()` is synchronous and side-effect free
- **Tasks keyed by chatId** — survive context switches, user can navigate away during generation

---

## Adding a New Entity Type

Follow the existing single-table pattern:

1. **Schema**: Update the canonical PocketBase init schema (`pocketbase/pb_migrations/1773000000_init_keiai_schema.js`) with a blind sync table (`userId`, `encryptedData`, `encryptedDataIV`, no FK/relation). Do not add incremental migrations while the project assumes a clean database.
2. **Adapter**: Add record types in `adapters/db/types.ts`, add table to Dexie schema in `db/web.ts`
3. **Service**: Create `services/content/<entity>.ts` — domain types, defaults, parse helpers, static CRUD class
4. **Refs**: Add `EntityListConfig<OrderedRef>` for owned child lists, or `EntityListConfig<ResourceRef>` for weak/shared refs
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
- [../docs/asset-system-v3.md](../docs/asset-system-v3.md) — Asset system specification
