# RisuAI Codebase Analysis Report

> Generated from analysis of RisuAI repository
> Analysis Date: 2026-02-26
> Purpose: Feature inventory and architecture reference for AI chat application development

---

## Table of Contents

- [Part 1: Feature Inventory](#part-1-feature-inventory)
- [Part 2: Architecture Deep Dive](#part-2-architecture-deep-dive)
- [Part 3: Dependency Map](#part-3-dependency-map)

---

# Part 1: Feature Inventory

## 1. Data Storage & Persistence

### 1.1 Database Structure

| Feature                  | Description                                             | Core Files                                   | Complexity |
| ------------------------ | ------------------------------------------------------- | -------------------------------------------- | ---------- |
| **Singleton Database**   | All application data stored in single monolithic object | `src/ts/storage/database.svelte.ts:709-1148` | High       |
| **MessagePack Encoding** | Binary serialization for efficient storage              | `src/ts/storage/risuSave.ts:118-369`         | Medium     |
| **Compression**          | Optional zlib/gzip compression via fflate               | `src/ts/storage/risuSave.ts`                 | Low        |
| **Encryption**           | Optional encryption for sensitive data                  | `src/ts/storage/risuSave.ts`                 | Medium     |

### 1.2 Storage Backends

| Backend            | Platform          | Files                              | Complexity |
| ------------------ | ----------------- | ---------------------------------- | ---------- |
| **LocalForage**    | Browser (default) | `src/ts/storage/autoStorage.ts`    | Low        |
| **OPFS**           | Modern browsers   | `src/ts/storage/autoStorage.ts`    | Medium     |
| **Tauri FS**       | Desktop apps      | `src/ts/storage/autoStorage.ts`    | Low        |
| **NodeStorage**    | Node.js server    | `src/ts/storage/autoStorage.ts`    | Medium     |
| **AccountStorage** | Cloud sync        | `src/ts/storage/accountStorage.ts` | High       |

### 1.3 Asset Management

| Feature            | Description                                       | Files                                | Complexity |
| ------------------ | ------------------------------------------------- | ------------------------------------ | ---------- |
| **Asset Storage**  | Separate storage for binary assets (images, etc.) | `src/ts/globalApi.svelte.ts:228-273` | Low        |
| **Hash-based IDs** | SHA-256 hashing for asset deduplication           | `src/ts/globalApi.svelte.ts:235`     | Low        |
| **Inlay Assets**   | Special embedded assets for chat content          | `src/ts/process/files/inlays.ts`     | Medium     |

### 1.4 Import/Export

| Feature              | Formats                         | Files                                | Complexity |
| -------------------- | ------------------------------- | ------------------------------------ | ---------- |
| **Save Files**       | .risu format (MessagePack)      | `src/ts/storage/risuSave.ts`         | Medium     |
| **Character Export** | .risum, .risup, .charx, PNG     | `src/ts/characterCards.ts:57-443`    | High       |
| **Backup System**    | Automatic rotation (20 backups) | `src/ts/globalApi.svelte.ts:484-501` | Low        |

---

## 2. AI Processing Pipeline

| Feature                  | Description                            | Files                                       | Complexity |
| ------------------------ | -------------------------------------- | ------------------------------------------- | ---------- |
| **Chat Processing**      | Main request-response pipeline         | `src/ts/process/index.svelte.ts:82-1956`    | Very High  |
| **Streaming Response**   | Real-time streaming of AI responses    | `src/ts/process/index.svelte.ts:1486-1533`  | High       |
| **Provider Abstraction** | Unified interface for 20+ AI providers | `src/ts/process/request/request.ts:563-646` | High       |
| **Error Handling**       | Comprehensive retry and fallback       | `src/ts/process/request/*.ts`               | Medium     |

### Supported AI Providers

| Provider                         | Type  | Files                                 |
| -------------------------------- | ----- | ------------------------------------- |
| OpenAI                           | API   | `src/ts/process/request/openAI.ts`    |
| Anthropic Claude                 | API   | `src/ts/process/request/anthropic.ts` |
| Google Gemini                    | API   | `src/ts/process/request/google.ts`    |
| NovelAI                          | API   | `src/ts/process/request/novelai.ts`   |
| Groq                             | API   | `src/ts/process/request/groq.ts`      |
| Mistral AI                       | API   | `src/ts/process/request/mistral.ts`   |
| Cohere                           | API   | `src/ts/process/request/cohere.ts`    |
| Local Models (Ollama, KoboldCpp) | Local | `src/ts/process/request/*.ts`         |

---

## 3. Prompt Engine

| Feature              | Description                          | Files                                      | Complexity |
| -------------------- | ------------------------------------ | ------------------------------------------ | ---------- |
| **Prompt Assembly**  | Component-based message construction | `src/ts/process/index.svelte.ts:300-500`   | Very High  |
| **Template System**  | Customizable prompt order            | `src/ts/process/prompt.ts`                 | High       |
| **Token Management** | Context limit management             | `src/ts/process/index.svelte.ts:1034-1418` | High       |
| **Cache Points**     | Prompt caching for efficiency        | `src/ts/process/index.svelte.ts:1395-1418` | Medium     |

### 3.1 Memory Systems

| Memory System      | Description                     | Files                                 | Complexity |
| ------------------ | ------------------------------- | ------------------------------------- | ---------- |
| **HypaMemory V3**  | Advanced embedding-based memory | `src/ts/process/memory/hypav3.ts`     | Very High  |
| **HypaMemory V2**  | Previous generation             | `src/ts/process/memory/hypav2.ts`     | High       |
| **SupaMemory**     | Legacy summarization            | `src/ts/process/memory/supaMemory.ts` | Medium     |
| **Hanurai Memory** | Custom implementation           | `src/ts/process/memory/hanurai.ts`    | High       |

### 3.2 Lorebook System

| Feature                    | Description                    | Files                                    | Complexity |
| -------------------------- | ------------------------------ | ---------------------------------------- | ---------- |
| **Lorebook Matching**      | Keyword-based activation       | `src/ts/process/lorebook.svelte.ts`      | High       |
| **Position Injection**     | before_desc, after_desc, depth | `src/ts/process/index.svelte.ts:444-504` | Medium     |
| **Child Lorebooks**        | Hierarchical lore entries      | `src/ts/process/lorebook.svelte.ts`      | Medium     |
| **Probability Activation** | Stochastic activation          | `src/ts/process/lorebook.svelte.ts`      | Low        |

---

## 4. Character Cards System

### 4.1 Data Schema

| Property        | Type               | Description              |
| --------------- | ------------------ | ------------------------ |
| `name`          | string             | Character name           |
| `image`         | string (asset ID)  | Character avatar         |
| `firstMessage`  | string             | Greeting message         |
| `desc`          | string             | Character description    |
| `personality`   | string             | Personality traits       |
| `scenario`      | string             | Scenario context         |
| `chats`         | Chat[]             | Array of chat sessions   |
| `globalLore`    | loreBook[]         | Character's lorebook     |
| `emotionImages` | [string, string][] | Emotion to asset mapping |
| `bias`          | [string, number][] | Token bias parameters    |
| `customscript`  | customscript[]     | Custom scripts           |
| `triggerscript` | triggerscript[]    | Trigger scripts          |

**Core File:** `src/ts/storage/database.svelte.ts:1202-1339`

### 4.2 Import/Export Formats

| Format         | Description                 | Files                              | Complexity |
| -------------- | --------------------------- | ---------------------------------- | ---------- |
| **.risum**     | Risu module format          | `src/ts/characterCards.ts:592-603` | Medium     |
| **.risup**     | Risu preset format          | `src/ts/characterCards.ts:582-591` | Low        |
| **.charx**     | Compressed character format | `src/ts/characterCards.ts:82-164`  | High       |
| **Tavern PNG** | PNG-embedded character card | `src/ts/characterCards.ts:166-389` | High       |
| **JSON**       | JSON format                 | `src/ts/characterCards.ts:57-78`   | Low        |
| **Chub API**   | Import from chub.ai         | `src/ts/characterCards.ts:416-443` | Medium     |

---

## 5. UI/UX System

### 5.1 Routing & Navigation

| Feature                     | Description                          | Files                              | Complexity |
| --------------------------- | ------------------------------------ | ---------------------------------- | ---------- |
| **Component-based Routing** | Conditional rendering based on state | `src/App.svelte`                   | Low        |
| **Mobile Navigation**       | Stack-based navigation               | `src/lib/Mobile/MobileBody.svelte` | Medium     |
| **Desktop Sidebar**         | Collapsible sidebar                  | `src/lib/SideBars/Sidebar.svelte`  | Low        |

### 5.2 Theme System

| Feature           | Options                | Files                       | Complexity |
| ----------------- | ---------------------- | --------------------------- | ---------- |
| **Color Schemes** | 10+ built-in themes    | `src/ts/gui/colorscheme.ts` | Medium     |
| **Custom CSS**    | User-defined styles    | `src/ts/gui/colorscheme.ts` | Low        |
| **Font Options**  | Multiple font families | `src/ts/gui/colorscheme.ts` | Low        |

### 5.3 Display Modes

| Mode                     | Description                       | Files                                   | Complexity |
| ------------------------ | --------------------------------- | --------------------------------------- | ---------- |
| **Classic**              | Standard chat interface           | `src/lib/ChatScreens/ChatScreen.svelte` | Low        |
| **Visual Novel (Waifu)** | Split-screen with character image | `src/lib/ChatScreens/ChatScreen.svelte` | Medium     |
| **Waifu Mobile**         | Mobile visual novel mode          | `src/lib/ChatScreens/ChatScreen.svelte` | Medium     |

---

## 6. Plugin System

### 6.1 Plugin API

| Version      | Features                 | Files                               | Complexity |
| ------------ | ------------------------ | ----------------------------------- | ---------- |
| **API v2.0** | Deprecated               | `src/ts/plugins/plugins.svelte.ts`  | -          |
| **API v2.1** | Safety checks            | `src/ts/plugins/plugins.svelte.ts`  | Medium     |
| **API v3.0** | Current, full sandboxing | `src/ts/plugins/apiV3/v3.svelte.ts` | Very High  |

### 6.2 Plugin Capabilities

| Capability              | Description                              | Files                               |
| ----------------------- | ---------------------------------------- | ----------------------------------- |
| **Custom AI Providers** | Add new AI services                      | `src/ts/plugins/apiV3/risuai.d.ts`  |
| **UI Injection**        | Custom UI components                     | `src/ts/plugins/apiV3/v3.svelte.ts` |
| **Event Hooks**         | editinput, editoutput, editdisplay, etc. | `src/ts/plugins/plugins.svelte.ts`  |
| **Tool Registration**   | MCP tool integration                     | `src/ts/plugins/apiV3/v3.svelte.ts` |

### 6.3 Sandboxing

| Feature                 | Description                  | Files                               |
| ----------------------- | ---------------------------- | ----------------------------------- |
| **SafeDocument**        | Restricted DOM access        | `src/ts/plugins/apiV3/v3.svelte.ts` |
| **SafeLocalStorage**    | Isolated storage             | `src/ts/plugins/apiV3/v3.svelte.ts` |
| **Code Safety Checker** | Static analysis for security | `src/ts/plugins/plugins.svelte.ts`  |

---

## 7. External Integrations

### 7.1 Text-to-Speech (TTS)

| Service           | Type             | Files                   | Complexity |
| ----------------- | ---------------- | ----------------------- | ---------- |
| Web Speech API    | Browser built-in | `src/ts/process/tts.ts` | Low        |
| ElevenLabs        | Premium API      | `src/ts/process/tts.ts` | Medium     |
| VOICEVOX          | Japanese TTS     | `src/ts/process/tts.ts` | Medium     |
| OpenAI TTS        | API              | `src/ts/process/tts.ts` | Low        |
| NovelAI TTS       | API              | `src/ts/process/tts.ts` | Medium     |
| VITS / GPT-SoVITS | Local            | `src/ts/process/tts.ts` | High       |

### 7.2 Image Generation

| Service                | Type  | Files                      | Complexity |
| ---------------------- | ----- | -------------------------- | ---------- |
| Stable Diffusion WebUI | Local | `src/ts/process/imggen.ts` | Medium     |
| NovelAI Image          | API   | `src/ts/process/imggen.ts` | Low        |
| DALL-E 3               | API   | `src/ts/process/imggen.ts` | Low        |
| ComfyUI                | Local | `src/ts/process/imggen.ts` | High       |
| Fal.ai                 | API   | `src/ts/process/imggen.ts` | Medium     |

### 7.3 Translation

| Service          | Type           | Files                             | Complexity |
| ---------------- | -------------- | --------------------------------- | ---------- |
| Google Translate | API            | `src/ts/translator/translator.ts` | Low        |
| DeepL            | API            | `src/ts/translator/translator.ts` | Medium     |
| LLM-based        | AI translation | `src/ts/translator/translator.ts` | Medium     |
| Bergamot         | Local browser  | `src/ts/translator/translator.ts` | High       |

### 7.4 MCP (Model Context Protocol)

| MCP                     | Type                     | Files                                         |
| ----------------------- | ------------------------ | --------------------------------------------- |
| **Internal MCPs**       | Built-in tools           | `src/ts/process/mcp/`                         |
| `internal:fs`           | File system access       | `src/ts/process/mcp/internal/fs.ts`           |
| `internal:risuai`       | RisuAI access            | `src/ts/process/mcp/risuaccess/`              |
| `internal:aiaccess`     | AI model access          | `src/ts/process/mcp/internal/aiaccess.ts`     |
| `internal:googlesearch` | Web search               | `src/ts/process/mcp/internal/googlesearch.ts` |
| **External MCPs**       | Third-party integrations | `src/ts/process/mcp/mcp.ts`                   |

---

## 8. Sync & Cloud

| Feature                 | Description         | Files                              | Complexity |
| ----------------------- | ------------------- | ---------------------------------- | ---------- |
| **Google Drive Backup** | OAuth-based backup  | `src/ts/drive/drive.ts`            | High       |
| **Multi-user Sync**     | WebRTC P2P sync     | `src/ts/sync/multiuser.ts`         | Very High  |
| **Account Storage**     | Cloud-based storage | `src/ts/storage/accountStorage.ts` | High       |
| **Realm (Marketplace)** | Character sharing   | `src/ts/realm.ts`                  | Medium     |

---

## 9. Parser & Scripting

### 9.1 Parser Features

| Feature            | Syntax                                    | Files                     | Complexity |
| ------------------ | ----------------------------------------- | ------------------------- | ---------- |
| **Variables**      | `{{variable}}`                            | `src/ts/parser.svelte.ts` | Low        |
| **Conditionals**   | `#if`, `#when`, `#each`                   | `src/ts/parser.svelte.ts` | Medium     |
| **Function Calls** | `{{call::function::args}}`                | `src/ts/parser.svelte.ts` | Medium     |
| **Assets**         | `{{img::}}`, `{{audio::}}`, `{{video::}}` | `src/ts/parser.svelte.ts` | Low        |
| **Inlays**         | `{{inlay::}}`, `{{inlayed::}}`            | `src/ts/parser.svelte.ts` | Medium     |
| **Math**           | `$$(expression)$$` (KaTeX)                | `src/ts/parser.svelte.ts` | Low        |
| **CSS**            | `<style>` blocks                          | `src/ts/parser.svelte.ts` | Medium     |

### 9.2 Script Types

| Type                | Description                                     | Files                          | Complexity |
| ------------------- | ----------------------------------------------- | ------------------------------ | ---------- |
| **Custom Scripts**  | Regex-based text processing                     | `src/ts/process/scripts.ts`    | Medium     |
| **Trigger Scripts** | Lua/Python execution                            | `src/ts/process/scriptings.ts` | High       |
| **Script Modes**    | editinput, editoutput, editprocess, editdisplay | `src/ts/process/scripts.ts`    | -          |

### 9.3 Script Functions (Lua)

| Category      | Functions                                | Files                          |
| ------------- | ---------------------------------------- | ------------------------------ |
| **Chat**      | getChatVar, setChatVar, addChat, cutChat | `src/ts/process/scriptings.ts` |
| **Character** | getName, setName, getDescription         | `src/ts/process/scriptings.ts` |
| **Lore**      | getLoreBooksMain, upsertLocalLoreBook    | `src/ts/process/scriptings.ts` |
| **AI**        | LLMMain, simpleLLM, generateImage        | `src/ts/process/scriptings.ts` |
| **System**    | alertError, stopChat, reloadDisplay      | `src/ts/process/scriptings.ts` |

---

## 10. Other Features

| Feature                  | Description                       | Files                           | Complexity |
| ------------------------ | --------------------------------- | ------------------------------- | ---------- |
| **Tokenizer**            | Token counting for various models | `src/ts/tokenizer/tokenizer.ts` | High       |
| **Hotkeys**              | Keyboard shortcuts                | `src/ts/hotkey/index.ts`        | Medium     |
| **Notifications**        | Desktop notifications             | `src/ts/notification.ts`        | Low        |
| **Auto-update**          | Application update system         | `src/ts/update.ts`              | Medium     |
| **i18n**                 | Multi-language support            | `src/lang/`                     | Medium     |
| **PNG Chunk Processing** | PNG metadata extraction           | `src/ts/util.ts` (PngChunk)     | Medium     |

---

# Part 2: Architecture Deep Dive

## 2.1 Data Architecture

### Core Storage Pattern: Singleton Database

RisuAI uses a **monolithic singleton database** architecture where all application data is stored in a single `Database` object that is serialized as a complete unit on every save.

### Database Structure

**File:** `src/ts/storage/database.svelte.ts:709-1148`

```typescript
export interface Database {
    // Characters and Groups
    characters: (character | groupChat)[];

    // AI Configurations
    botPresets: botPreset[];

    // Plugins
    modules: RisuModule[];

    // User Account
    account: account;

    // ... 50+ other properties
}
```

### Character → Chat → Message Hierarchy

```
Database
  └── characters[]: (character | groupChat)[]
       └── character.chats[]: Chat[]
            └── Chat.message[]: Message[]
```

### Save Process

**File:** `src/ts/globalApi.svelte.ts:322-428`

```
[Database Change] → [Debounce 500ms] → [MessagePack Encode] → [Storage Write]
```

**Critical Observation:** When adding a single message, the **entire database** is:

1. Serialized via MessagePack encoder
2. Optionally compressed (zlib/gzip)
3. Written to storage as one file

### Performance Implications

| Aspect                | Impact                                           |
| --------------------- | ------------------------------------------------ |
| **Write Performance** | Degrades with database size (full serialization) |
| **Memory Usage**      | Entire database loaded in memory                 |
| **Sync Efficiency**   | Full file transmission (no delta sync)           |
| **Scalability**       | Limited for very large chat histories            |

### Storage Backend Abstraction

**File:** `src/ts/storage/autoStorage.ts`

```typescript
class AutoStorage {
    realStorage: LocalForage | NodeStorage | OpfsStorage | AccountStorage;
}
```

### Asset Management

**Files:** `src/ts/globalApi.svelte.ts:228-273`

| Aspect            | Implementation                            |
| ----------------- | ----------------------------------------- |
| **Storage**       | Separate from database (individual files) |
| **ID Generation** | SHA-256 hash of content (deduplication)   |
| **File Format**   | Original extension preserved              |
| **Location**      | `assets/{hash}.{ext}`                     |

### I/O Operations Analysis

**Operation: Add 1 Message**

1. **Memory:** Push to `db.characters[i].chats[j].message[]`
2. **Trigger:** Svelte reactivity triggers save
3. **Debounce:** 500ms wait
4. **Encode:** Entire database → MessagePack
5. **Compress:** Optional (if enabled)
6. **Write:** Single file to storage

**Sync Implications:**

- Entire database file transmitted
- No incremental/delta sync
- Large databases = slow sync times

---

## 2.2 Chat Processing Pipeline

### Complete Data Flow

```
[User Input]
    ↓
DefaultChatScreen.sendMain()
    ↓
processMultiCommand() (if /command)
    ↓
processScript() [editinput mode]
    ↓
risuChatParser() [variable parsing]
    ↓
sendChat() in src/ts/process/index.svelte.ts
    ↓
┌─────────────────────────────────────────────┐
│ Stage 1: Setup (lines 91-108)              │
│ - Initialize abort controller               │
│ - Set processing stage                      │
│ - Cache character lookup                    │
└─────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────┐
│ Stage 2: Character/Chat (lines 246-295)    │
│ - Handle group chats                        │
│ - Initialize ChatTokenizer                  │
│ - Set max context tokens                    │
└─────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────┐
│ Stage 3: Prompt Assembly (lines 298-499)   │
│ - Build unformated object                   │
│ - Load system prompts                       │
│ - Load lorebook entries                     │
│ - Load character description                │
└─────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────┐
│ Stage 4: Message Processing (lines 798-945)│
│ - Process each message via risuChatParser   │
│ - Handle inlay assets                       │
│ - Extract <Thoughts> tags                   │
│ - Apply multimodal content                  │
└─────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────┐
│ Stage 5: Memory Processing (lines 960-1032)│
│ - Hanurai Memory (if enabled)               │
│ - HypaMemory V2 (if enabled)                │
│ - HypaMemory V3 (if enabled)                │
│ - SupaMemory (fallback)                     │
└─────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────┐
│ Stage 6: Token Management (lines 1034-1418)│
│ - Calculate total tokens                    │
│ - Trim if over limit                        │
│ - Apply cache points                        │
└─────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────┐
│ Stage 7: Final Assembly (lines 1113-1363)  │
│ - Assemble messages[] array                 │
│ - Apply prompt template order               │
└─────────────────────────────────────────────┘
    ↓
requestChatData() in src/ts/process/request/request.ts
    ↓
[Provider-Specific Handler]
    - requestOpenAI()
    - requestClaude()
    - requestGoogle()
    - etc.
    ↓
[API Request & Streaming Response]
    ↓
┌─────────────────────────────────────────────┐
│ Stream Processing (lines 1486-1533)        │
│ - Read chunks from ReadableStream           │
│ - Update UI in real-time                    │
│ - Accumulate full response                  │
└─────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────┐
│ Post-Processing                             │
│ - processScriptFull() [editoutput mode]     │
│ - Run output triggers                       │
│ - Process inlay screens                     │
│ - TTS (if enabled)                          │
│ - Emotion updates                           │
└─────────────────────────────────────────────┘
    ↓
[UI Update]
    - Update database store
    - Trigger Svelte re-render
    - Auto-scroll to new message
```

### Key Files

| Stage            | File                                                   | Function                |
| ---------------- | ------------------------------------------------------ | ----------------------- |
| Entry            | `src/lib/ChatScreens/DefaultChatScreen.svelte:143-200` | `sendMain()`            |
| Main Processing  | `src/ts/process/index.svelte.ts:82-1956`               | `sendChat()`            |
| Request Dispatch | `src/ts/process/request/request.ts:563-646`            | `requestChatDataMain()` |
| Parser           | `src/ts/parser.svelte.ts:1511-1785`                    | `risuChatParser()`      |

---

## 2.3 Prompt Engine Architecture

### Message Assembly Order

**File:** `src/ts/process/index.svelte.ts:300-500`

The final `messages[]` array is assembled from these components:

### 1. Unformatted Structure Setup

```typescript
let unformated = {
    main: [], // System prompts & main instructions
    jailbreak: [], // Jailbreak prompts (if enabled)
    chats: [], // Chat history & current message
    lorebook: [], // Lorebook entries
    globalNote: [], // Global notes
    authorNote: [], // Author notes
    lastChat: [], // Last chat continuation
    description: [], // Character description
    postEverything: [], // Post-instruction prompts
    personaPrompt: [], // User persona prompts
};
```

### 2. Component Assembly Sequence

| Component               | Source                                        | Injection Point                 |
| ----------------------- | --------------------------------------------- | ------------------------------- |
| System Prompt           | Character + Global Settings                   | `unformated.main`               |
| Jailbreak               | Optional                                      | `unformated.jailbreak`          |
| Global Note             | Database                                      | `unformated.globalNote`         |
| Character Description   | `character.desc` + `personality` + `scenario` | `unformated.description`        |
| Lorebooks (before_desc) | Position-based                                | Before description              |
| Lorebooks (normal)      | Keyword match                                 | `unformated.lorebook`           |
| Lorebooks (depth=0)     | Position-based                                | `unformated.postEverything`     |
| User Persona            | Database                                      | `unformated.personaPrompt`      |
| Example Messages        | `character.exampleMessage`                    | Before chat history             |
| Chat History            | Actual conversation                           | `unformated.chats`              |
| Memory Summary          | Memory system                                 | Between history and new message |
| Current User Message    | User input                                    | Last in `chats`                 |

### 3. Template-Based Assembly (If promptTemplate exists)

```typescript
for (const card of template) {
    switch (card.type) {
        case "persona": // User persona
        case "description": // Character description
        case "authornote": // Author notes
        case "lorebook": // Lorebook entries
        case "postEverything": // Post-instructions
        case "chat": // Chat history (with range selection)
        case "memory": // Memory summaries
        case "cache": // Cache points
        case "plain": // Custom text
        case "jailbreak": // Jailbreak
        case "cot": // Chain of thought
    }
}
```

### 4. Default Assembly Order

```typescript
formatOrder = [
    "main",
    "jailbreak",
    "globalNote",
    "authorNote",
    "description",
    "lorebook",
    "personaPrompt",
    "chats",
    "lastChat",
    "postEverything",
];
```

### Memory Systems Token Management

| Memory System     | Strategy                  | Token Allocation                  |
| ----------------- | ------------------------- | --------------------------------- |
| **HypaMemory V3** | Embedding-based selection | `memoryTokensRatio` (default 20%) |
| **HypaMemory V2** | Semantic similarity       | Configurable budget               |
| **SupaMemory**    | Summarization             | Fills remaining budget            |
| **Hanurai**       | Custom                    | Configurable                      |

**File:** `src/ts/process/index.svelte.ts:960-1032`

### Lorebook Activation Logic

**File:** `src/ts/process/lorebook.svelte.ts`

| Trigger Type    | Description                       |
| --------------- | --------------------------------- |
| **Keyword**     | Regex or word matching            |
| **Recursive**   | Content can trigger other entries |
| **Probability** | Stochastic activation (0-100%)    |
| **Position**    | before_desc, after_desc, depth=N  |

---

## 2.4 Asset Management

### Storage Architecture

```
Assets
├── Storage: Separate from database (individual files)
├── ID: SHA-256 hash of content (content-addressable)
├── Path: assets/{hash}.{extension}
└── Reference: Database stores path strings only
```

### Asset Lifecycle

**Save Asset** (`src/ts/globalApi.svelte.ts:228-258`)

```
[Binary Data]
    ↓
Calculate SHA-256 hash (or generate UUID)
    ↓
Determine file extension
    ↓
Write to assets/{hash}.{ext}
    ↓
Return path string
```

**Load Asset** (`src/ts/globalApi.svelte.ts:266-273`)

```
[Asset Path]
    ↓
Read from storage backend
    ↓
Return binary data
```

### Asset Types

| Type           | Usage                             | Syntax                             |
| -------------- | --------------------------------- | ---------------------------------- |
| **Image**      | Character avatars, emotion images | `{{img::name}}`                    |
| **Video**      | Embedded video content            | `{{video::name}}`                  |
| **Audio**      | Background music, sound effects   | `{{audio::name}}`, `{{bgm::name}}` |
| **Background** | Chat background                   | `{{bg::name}}`                     |
| **Inlay**      | Special embedded content          | `{{inlay::id}}`, `{{inlayed::id}}` |

### Inlay Assets

**File:** `src/ts/process/files/inlays.ts`

| Feature        | Description                       |
| -------------- | --------------------------------- |
| **Embedding**  | Assets embedded in chat messages  |
| **Processing** | `{{inlayed::filename}}` syntax    |
| **Display**    | Custom UI rendering               |
| **Security**   | Path validation, sandboxed access |

### Realm (Marketplace) Asset Handling

When sharing characters to Realm:

- Character data uploaded separately
- Assets referenced by path
- [미확인] Exact asset upload mechanism

---

# Part 3: Dependency Map

## Core Dependency Graph

```
                    ┌─────────────────┐
                    │   Storage Layer │
                    │  (database.ts)  │
                    └────────┬────────┘
                             │
           ┌─────────────────┼─────────────────┐
           │                 │                 │
           ↓                 ↓                 ↓
    ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
    │   Character │  │     Chat    │  │  Presets    │
    │    Cards    │←→│  Processing │←→│ (botPresets)│
    └─────────────┘  └──────┬──────┘  └─────────────┘
                            │
           ┌────────────────┼────────────────┐
           │                │                │
           ↓                ↓                ↓
    ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
    │   Prompt    │  │   Memory    │  │  Lorebook   │
    │   Engine    │←→│   Systems   │  │   System    │
    └──────┬──────┘  └─────────────┘  └─────────────┘
           │
           ↓
    ┌─────────────┐
    │   Request   │
    │ Dispatcher │
    └──────┬──────┘
           │
    ┌──────┴──────┐
    │             │
    ↓             ↓
┌─────────┐  ┌─────────┐
│Plugins  │  │   AI    │
│  API    │  │Providers│
└─────────┘  └─────────┘
```

## Detailed Dependencies

### Storage Dependencies

```
Storage
├── Database (singleton)
│   ├── Characters
│   │   ├── Character Cards
│   │   ├── Chats
│   │   │   └── Messages
│   │   └── Lorebooks
│   ├── Bot Presets
│   └── Account Data
└── Assets (separate)
    ├── Images
    ├── Audio
    └── Videos
```

### Processing Dependencies

```
Chat Processing
├── Parser (risuChatParser)
│   ├── Variable System
│   ├── Conditionals
│   └── Function Calls
├── Scripts
│   ├── Custom Scripts (regex)
│   └── Trigger Scripts (Lua/Python)
├── Prompt Engine
│   ├── Memory Systems
│   ├── Lorebook System
│   └── Template System
└── Request Dispatcher
    ├── Provider Handlers
    └── Plugin Providers
```

### UI Dependencies

```
UI Layer
├── Routing (App.svelte)
├── Theme System
├── Layouts
│   ├── Desktop (Sidebar)
│   └── Mobile (Stack-based)
└── Chat Screens
    ├── Classic
    └── Visual Novel (Waifu)
```

## Cross-Cutting Concerns

```
┌─────────────────────────────────────────────────────────┐
│                    Cross-Cutting                        │
├─────────────────────────────────────────────────────────┤
│  • Plugins (can hook into processing pipeline)          │
│  • Translator (can process all text)                    │
│  • TTS (can process AI responses)                       │
│  • Image Generation (triggered by scripts)              │
│  • MCP Tools (available during processing)              │
│  • Sync (operates on entire database)                   │
└─────────────────────────────────────────────────────────┘
```

---

# Summary & Key Insights

## Architectural Strengths

1. **Unified Provider Interface:** 20+ AI providers through consistent API
2. **Flexible Prompt Engine:** Template-based, highly customizable
3. **Rich Plugin System:** Extensible with sandboxed execution
4. **Multiple Memory Systems:** Advanced context management
5. **Cross-Platform:** Web, Desktop (Tauri), Mobile support

## Architectural Limitations

1. **Singleton Database:**
    - Full serialization on every save
    - No incremental writes
    - Performance degrades with size
    - Full file sync (no delta)

2. **No Pagination:**
    - Entire chat history loaded into memory
    - No lazy loading for long conversations

3. **Tight Coupling:**
    - Database directly coupled to Svelte stores
    - Hard to extract business logic from UI

## Recommendations for New Projects

1. **Use IndexedDB/SQLite:** Individual record storage instead of monolithic
2. **Implement Pagination:** Lazy load chat history
3. **Delta Sync:** Send only changes during sync
4. **Separate Business Logic:** Decouple from UI framework
5. **Plugin Safety:** Maintain sandboxing approach

---

**Report Generation Complete**

_All file paths relative to repository root (`src/ts/`)_
_All line numbers based on analyzed codebase state_
