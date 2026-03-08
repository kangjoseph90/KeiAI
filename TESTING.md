# Testing Guidelines — KeiAI

This document covers testing conventions, infrastructure, and coverage goals for the KeiAI codebase.

---

## Table of Contents

1. [Test Infrastructure](#1-test-infrastructure)
2. [Test File Organization](#2-test-file-organization)
3. [Test Naming & Structure](#3-test-naming--structure)
4. [Crypto Tests](#4-crypto-tests)
5. [Adapter Tests](#5-adapter-tests)
6. [Service Layer Tests](#6-service-layer-tests)
7. [Mocking PocketBase](#7-mocking-pocketbase)
8. [Svelte Component Tests](#8-svelte-component-tests)
9. [Coverage Goals](#9-coverage-goals)
10. [Test Utilities](#10-test-utilities)
11. [Running Tests](#11-running-tests)

---

## 1. Test Infrastructure

We use **Vitest** as the test runner with **happy-dom** for DOM simulation.

```bash
pnpm test           # Run tests in watch mode
pnpm test:run       # Run all tests once
pnpm test:ui        # Run tests with UI
pnpm test:coverage  # Run tests with coverage report
```

---

## 2. Test File Organization

```
tests/
├── setup.ts           # Global test configuration (vitest setup file)
├── mocks/             # Mock handlers and fixtures
│   └── handlers.ts    # MSW handlers for PocketBase API
├── unit/              # Pure unit tests (no Svelte components)
│   ├── crypto/        # Crypto module tests
│   ├── adapters/      # DB, KV, storage adapter tests
│   ├── services/      # Service layer tests
│   └── stores/        # Store tests
└── integration/       # Multi-layer integration tests
```

---

## 3. Test Naming & Structure

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('ModuleName', () => {
	describe('functionName', () => {
		it('should describe the expected behavior', async () => {
			// Arrange
			const input = 'test';

			// Act
			const result = await functionName(input);

			// Assert
			expect(result).toBe('expected');
		});
	});
});
```

- Use `describe` blocks to group related tests (by module, then by function)
- Test names follow `should` + expected outcome format
- Use `arrange / act / assert` comments for complex tests
- Async tests use `async` / `await` consistently

---

## 4. Crypto Tests

**100% coverage required** — security-critical code has no margin for untested branches.

```typescript
// ✅ Test both success and failure paths
it('should decrypt correctly with valid key', async () => {
	const result = await decrypt(key, encrypted);
	expect(result).toBe(plaintext);
});

it('should throw error with wrong key', async () => {
	await expect(decrypt(wrongKey, encrypted)).rejects.toThrow();
});

it('should throw error with tampered data', async () => {
	const tampered = flipByte(encrypted.ciphertext, 0);
	await expect(decrypt(key, { ...encrypted, ciphertext: tampered })).rejects.toThrow();
});
```

### Key crypto test patterns:

| Pattern | Purpose |
| ------- | ------- |
| Encrypt/decrypt roundtrip | Verify data survives a full cycle |
| Random IV uniqueness | Same input produces different ciphertext each time |
| Wrong key failures | Decryption with incorrect key must throw |
| Tamper detection | Modified ciphertext or IV must fail authentication |
| Edge cases | Empty strings, unicode, very long inputs |

---

## 5. Adapter Tests

Adapters are tested against their interface contract. Use `fake-indexeddb` for Dexie tests.

```typescript
// Setup: fresh IndexedDB per test
beforeEach(() => {
	vi.stubGlobal('indexedDB', fakeIndexedDB);
	vi.stubGlobal('IDBKeyRange', FDBKeyRange);
});

// Test CRUD operations
it('should put and get record', async () => {
	await localDB.putRecord('testTable', { id: '1', data: 'test' });
	const result = await localDB.getRecord('testTable', '1');
	expect(result?.data).toBe('test');
});
```

---

## 6. Service Layer Tests

Services are tested in isolation with mocked adapters. Focus on business logic, not the underlying DB.

```typescript
// Mock adapters at the top of the file
vi.mock('$lib/adapters/db', () => ({
	localDB: {
		getRecord: vi.fn(),
		putRecord: vi.fn(),
		transaction: vi.fn()
	}
}));

// Test the service logic, not the adapter
it('should throw when character not found', async () => {
	vi.mocked(localDB.getRecord).mockResolvedValue(undefined);

	await expect(CharacterService.getDetail('missing-id')).rejects.toThrow(
		AppError
	);
});
```

---

## 7. Mocking PocketBase

PocketBase is mocked in `tests/setup.ts`. Use the mock instance for tests that need auth or sync.

```typescript
import { getMockPocketBase } from '../setup';

it('should authenticate with valid credentials', async () => {
	const mockPb = getMockPocketBase();
	mockPb.collection('users').authWithPassword.mockResolvedValue({
		token: 'test-token',
		record: { id: 'user-1', email: 'test@example.com' }
	});

	await AuthService.login('test@example.com', 'password');
	expect(mockPb.collection('users').authWithPassword).toHaveBeenCalled();
});
```

---

## 8. Svelte Component Tests

Use `@testing-library/svelte` for component tests. Focus on user behavior, not implementation details.

```typescript
import { render, screen } from '@testing-library/svelte';
import { expect } from 'vitest';
import Button from '$lib/components/ui/button/Button.svelte';

it('should call onClick when clicked', async () => {
	const handleClick = vi.fn();
	render(Button, { onClick: handleClick, children: 'Click me' });

	const button = screen.getByRole('button', { name: 'Click me' });
	await userEvent.click(button);

	expect(handleClick).toHaveBeenCalledTimes(1);
});
```

- Query by role or text (`getByRole`, `getByText`), not by CSS selectors
- Test user interactions (`click`, `type`), not internal state changes
- Avoid testing implementation details (component internals, CSS classes)

---

## 9. Coverage Goals

| Module           | Target | Notes                                  |
| ---------------- | ------ | -------------------------------------- |
| `crypto/`        | 100%   | Security-critical                      |
| `adapters/`      | 90%+   | Platform abstraction must be reliable   |
| `services/`      | 85%+   | Core business logic                    |
| `stores/`        | 80%+   | State management                       |
| `shared/utils/`  | 90%+   | Reused throughout codebase             |
| Components       | 70%+   | Focus on critical user flows           |

---

## 10. Test Utilities

Create reusable helpers in `tests/mocks/` or `tests/utils/`:

```typescript
// tests/mocks/crypto.ts
export async function createTestMasterKey(extractable = true): Promise<CryptoKey> {
	return crypto.subtle.generateKey(
		{ name: 'AES-GCM', length: 256 },
		extractable,
		['encrypt', 'decrypt']
	);
}

// tests/mocks/fixtures.ts
export const mockCharacter = {
	id: 'char-123',
	name: 'Test Character',
	shortDescription: 'A test character'
};
```

---

## 11. Running Tests

```bash
# Run only crypto tests
pnpm test tests/unit/crypto/

# Run a specific test file
pnpm test tests/unit/crypto/encryption.test.ts

# Run tests matching a pattern
pnpm test -- --grep "should encrypt"
```

### CI/CD Integration

Tests run automatically in CI. The `test:run` script exits with non-zero status on any failure, blocking merges. Keep tests fast — prefer unit tests over slow integration tests.
