# Store Layer

Svelte writable/derived stores providing a reactive, 3-level in-memory cache.
Orchestrates cross-service operations and keeps UI state consistent.

## Responsibilities

- **Own all writable state** — centralized in `state.ts`
- **Expose `readonly()` wrappers** to UI via `index.ts`
- **Orchestrate** multi-service writes (create entity + update parent refs)
- **Guard** store updates against stale context (`activeChatId` checks)
- **Compensating rollbacks** on failed multi-step writes

## State Hierarchy

```
Level 0 (Global)      appSettings
Level 1 (Lists)       characters, personas, promptPresets, modules, plugins, moduleResources
Level 2 (Character)   activeCharacter, chats, characterLorebooks, characterScripts, characterModules
Level 3 (Chat)        activeChat, messages, chatLorebooks
Context               activePreset, activeLorebooks, activeScripts
Derived               activeCharacterId, activeChatId, activeModuleIds, allLorebooks, allScripts, activePersona
```

Leaving a layer clears all lower layers.

## File Structure

| File                        | Purpose                                              |
| --------------------------- | ---------------------------------------------------- |
| `state.ts`                  | All writable + derived store declarations            |
| `index.ts`                  | `readonly()` re-exports, `loadGlobalState()`, barrel |
| `character.ts`              | Character CRUD + owned lorebook/script/folder ops    |
| `chat.ts`                   | Chat CRUD + owned lorebook/folder ops                |
| `message.ts`                | Message CRUD with chat preview sync                  |
| `module.ts`                 | Module CRUD + owned lorebook/script/folder ops       |
| `persona.ts`                | Persona CRUD                                         |
| `plugin.ts`                 | Plugin CRUD                                          |
| `promptPreset.ts`           | Preset CRUD with active preset management            |
| `settings.ts`               | Settings CRUD + global folder/item ops               |
| `lorebook.ts` / `script.ts` | Re-export only (CRUD in parent stores)               |

## Patterns

### Create with ref registration

1. `Service.create(entity)` → 2. Update parent refs → 3. On ref failure: compensating delete → 4. Update stores

### Delete with ref cleanup

1. Remove from parent refs → 2. `Service.delete(entity)` → 3. On delete failure: rollback refs → 4. Update stores

### Context guards

```typescript
if (get(activeChatId) !== chatId) return; // stale context, skip UI update
```

DB writes always proceed — stores are just cache.
