# Testing Guidelines — KeiAI App

```bash
pnpm test                            # Watch mode (re-runs on change)
pnpm test:run                        # All tests once (CI)
pnpm test:coverage                   # Coverage report
pnpm test tests/unit/crypto/         # Run specific directory
pnpm test tests/unit/services/character.test.ts  # Run specific file
```

---

## Stack

| Tool                        | Role                                 |
| --------------------------- | ------------------------------------ |
| Vitest                      | Test runner, assertions, mocking     |
| happy-dom                   | DOM simulation (test environment)    |
| fake-indexeddb              | In-memory IndexedDB for Dexie tests  |
| @testing-library/svelte     | Component rendering + queries        |
| @testing-library/user-event | User interaction simulation          |
| @testing-library/jest-dom   | Extended DOM matchers                |
| MSW                         | PocketBase API mocking (handlers.ts) |

---

## Test Layout

```
tests/
├── setup.ts                  # Global: fake-indexeddb, PB mock, Tauri mock, jest-dom matchers
├── mocks/
│   └── handlers.ts           # MSW handlers for all PocketBase endpoints + MockPocketBase
├── unit/
│   ├── crypto/               # encryption, kdf, masterKey, recovery
│   ├── adapters/             # db, kv, storage, user, clipboard, dialog, http, notification, window
│   ├── services/             # session, auth, user, character, chat, message, settings, persona, preset, ...
│   ├── stores/               # state, character, chat, message
│   └── shared/               # utils, ordering
└── integration/
    └── character_flow.test.ts # Cross-service flows with real Dexie
```

---

## Test Structure — AAA Pattern

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('ModuleName', () => {
	describe('methodName', () => {
		it('should describe expected behavior', async () => {
			// Arrange
			const input = setupTestData();

			// Act
			const result = await methodName(input);

			// Assert
			expect(result).toBe(expected);
		});
	});
});
```

---

## Coverage Goals

| Module      | Target   | Rationale                                  |
| ----------- | -------- | ------------------------------------------ |
| `crypto/`   | **100%** | Security-critical — no margin for error    |
| `adapters/` | 90%+     | Platform abstraction must be airtight      |
| `services/` | 85%+     | Core business logic, encrypt/decrypt paths |
| `stores/`   | 80%+     | State management, guard patterns           |
| `shared/`   | 90%+     | Reused across entire codebase              |
| Components  | 70%+     | Focus on critical user flows               |

---

## Mocking Strategy by Layer

### Crypto Tests — No Mocks

Crypto tests use real Web Crypto API (provided by happy-dom). They test actual encryption/decryption, not mocked behavior.

```typescript
async function createTestMasterKey(extractable = true): Promise<CryptoKey> {
	return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, extractable, [
		'encrypt',
		'decrypt'
	]);
}
```

**Required test cases for every crypto function:**

- Encrypt/decrypt roundtrip (correct key → original plaintext)
- Random IV uniqueness (same input → different ciphertext each time)
- Wrong key rejection
- Tamper detection (flip a byte → GCM auth fails)
- Edge cases: empty string, unicode, long text

### Adapter Tests — fake-indexeddb + vi.stubGlobal

Setup is done globally in `tests/setup.ts`:

```typescript
vi.stubGlobal('indexedDB', fakeIndexedDB);
vi.stubGlobal('IDBKeyRange', FDBKeyRange);
```

Test real Dexie operations against in-memory IndexedDB. No mocking of the adapter itself.

### Service Tests — Mock Adapters + Crypto + Session

Services are the primary unit-under-test. Mock everything below them:

```typescript
vi.mock('$lib/adapters/db', () => ({
	localDB: {
		getRecord: vi.fn(),
		putRecord: vi.fn(),
		transaction: vi.fn()
		// ... method stubs as needed
	}
}));

vi.mock('$lib/crypto', () => ({
	encrypt: vi.fn(),
	decrypt: vi.fn()
}));

vi.mock('$lib/services/session', () => ({
	getActiveSession: vi.fn()
}));

vi.mock('$lib/services/sync', () => ({
	DataSyncService: {
		pushRecord: vi.fn(),
		pushRecentWrites: vi.fn()
	}
}));
```

**Standard service test setup:**

```typescript
const mockMasterKey = {} as CryptoKey;
const mockUserId = 'user-123';

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(getActiveSession).mockReturnValue({
		userId: mockUserId,
		masterKey: mockMasterKey,
		isGuest: false
	});
});
```

**Test these paths for every CRUD service:**

- List (empty + populated)
- Get detail (exists + not found → `AppError`)
- Create (generates ID, encrypts, writes, pushes sync)
- Update (read-modify-write, encrypts, pushes sync)
- Delete (soft-delete, cascade children if applicable)
- Encryption failure handling (decrypt throws → `AppError('ENCRYPTION_FAILED')`)

### Store Tests — Mock Services

Store action functions are tested by mocking the service layer:

```typescript
vi.mock('$lib/services', () => ({
	CharacterService: {
		list: vi.fn(),
		getDetail: vi.fn(),
		create: vi.fn()
	}
}));
```

Verify that stores update correctly after action calls. Use `get(storeName)` from `svelte/store` to read store values in tests.

### Integration Tests — Real Dexie, Mocked Crypto + Session

Integration tests use real adapter operations against fake-indexeddb, but mock crypto to pass-through:

```typescript
vi.mocked(encrypt).mockImplementation(async (_key, data) => ({
	ciphertext: new TextEncoder().encode(data),
	iv: new Uint8Array([1, 2, 3])
}));

vi.mocked(decrypt).mockImplementation(async (_key, enc) => {
	return new TextDecoder().decode(enc.ciphertext);
});
```

This validates service → adapter → DB flows with real IndexedDB but without real encryption overhead.

**Tip**: Use a unique `userId` per test for isolation (no cross-test bleed in shared DB).

### Component Tests — @testing-library/svelte

```typescript
import { render, screen } from '@testing-library/svelte';
import { userEvent } from '@testing-library/user-event';

it('should handle user click', async () => {
	const handler = vi.fn();
	render(Button, { onClick: handler, children: 'Save' });

	await userEvent.click(screen.getByRole('button', { name: 'Save' }));

	expect(handler).toHaveBeenCalledOnce();
});
```

- Query by **role** or **text** — never CSS selectors or test IDs as first choice
- Test **user behavior**, not implementation details
- Don't assert on CSS classes or internal state

- Skip crypto edge cases | Always test tamper detection + wrong key |
- Use hard-coded partial objects for complex types | Use `makeSettings()` / `makeCharacter()` helpers |

---

## Test Utilities & Fixtures

When testing modules with deeply nested configurations (like `AppSettings`), use the helper utilities in `tests/utils.ts` to avoid type errors and verbose setup.

### `DeepPartial<T>`

Found in `$lib/utils/defaults`, this type makes every property in a tree optional. Use it for update inputs or test overrides where you don't want to satisfy a large, required interface.

### `makeSettings(overrides)`

Builds a complete, valid `AppSettings` object by recursively merging your overrides onto the `defaultSettings`.

```typescript
import { makeSettings } from '../utils';

// NO: verbose and fails if new required fields are added
appSettings.set({ theme: 'dark', ...restOfRequiredFields } as AppSettings);

// YES: clean, type-safe, and future-proof
appSettings.set(
	makeSettings({
		theme: 'dark',
		openai: { apiKey: 'sk-test' }
	})
);
```

---

## Global Test Setup (tests/setup.ts)

The setup file configures the test environment before any tests run:

1. **jest-dom matchers** — extends `expect` with `.toBeInTheDocument()`, etc.
2. **fake-indexeddb** — replaces global `indexedDB` with in-memory implementation
3. **PocketBase mock** — `vi.mock('$lib/adapters/pb')` returns a mock client with auth, collection CRUD, realtime
4. **Tauri API mocks** — stubs `@tauri-apps/api/core`, `@tauri-apps/plugin-fs` (tests always run in Web mode)
5. **Cleanup** — `@testing-library/svelte` cleanup runs after each test automatically

---

## Writing a New Test

1. Create file in the appropriate `tests/unit/<layer>/` directory, named `<module>.test.ts`
2. Add imports from vitest + module under test
3. Mock dependencies at the layer boundary (service tests mock adapters, store tests mock services)
4. Write `describe` blocks mirroring the public API of the module
5. Cover success path, error path, and edge cases
6. Run with `pnpm test <path>` until green
7. Check coverage with `pnpm test:coverage` for gaps

---

## Anti-Patterns

| Don't                                              | Do Instead                                                                                         |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Mock the module you're testing                     | Mock its dependencies                                                                              |
| Test internal helper functions directly            | Test through the public API                                                                        |
| Use `vi.useFakeTimers()` with Dexie/fake-indexeddb | Use real `setTimeout` or `await/expect` polling instead (Fake timers break IndexedDB transactions) |
| Share mutable state between tests                  | Reset in `beforeEach` with `vi.clearAllMocks()`                                                    |
| Write one massive test                             | Split into focused tests per behavior                                                              |
| Skip crypto edge cases                             | Always test tamper detection + wrong key                                                           |
