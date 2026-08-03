# Testing

Use Vitest to protect meaningful behavior and regressions at the narrowest useful boundary. Do not test implementation details, trivial forwarding, or behavior already guaranteed by a lower layer.

## Commands

```bash
pnpm test:run -- tests/unit/path/to/file.test.ts
pnpm test:run
pnpm check
```

Run focused tests for the changed contract. Run the full suite or type check when the change has broad impact.

## Boundaries

- Test pure utilities directly.
- Use real Web Crypto and in-memory IndexedDB when their behavior matters.
- Mock platform, network, provider, and persistence boundaries that are outside the subject.
- For Services, test domain behavior through their public API.
- For Stores and Managers, test the state or orchestration contract rather than internal calls.
- For Tasks and Workflows, test lifecycle, cancellation, persistence, and externally visible output when relevant.
- For components, test rendered user behavior.

Use integration tests only when the interaction between real layers is the behavior under test.

## Isolation

- Tests must not depend on order or leaked state.
- Reset only the Stores, databases, globals, timers, modules, and spies changed by the test.
- `vi.mock()` is hoisted; use `vi.hoisted()` when its factory needs shared state.
- Do not use fake timers during an IndexedDB transaction.
- Await the operation or observable completion signal instead of sleeping.
- Keep fixtures valid and typed; make malformed input explicit in the test.

Security-sensitive tests should cover tampering and invalid credentials when those paths are part of the changed contract. Data mutations should cover partial-failure behavior when atomicity matters.
