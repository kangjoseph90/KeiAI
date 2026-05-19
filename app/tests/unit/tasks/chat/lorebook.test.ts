import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveLorebookEntries } from '$lib/tasks/chat/lorebook';
import { runTemplate } from '$lib/template';
import type { Lorebook, PagedMessages } from '$lib/services';
import type { TemplateContext } from '$lib/template';

// Mock dependencies
vi.mock('$lib/template', () => ({
    runTemplate: vi.fn((content) => content),
    createDryRunMacros: vi.fn(() => new Map())
}));

describe('Lorebook Resolver (resolveLorebookEntries)', () => {
    const mockTemplateCtx: TemplateContext = {
        characterId: 'char-1',
        chatId: 'chat-1'
    };

    const createMockLorebook = (overrides: Partial<Lorebook>): Lorebook => ({
        id: 'lb-' + Math.random(),
        ownerId: 'user-1',
        name: 'Mock',
        key: '',
        secondKey: '',
        content: '',
        depth: 0,
        order: 100,
        alwaysActive: false,
        disabled: false,
        role: 'system',
        useRegex: false,
        useMultipleKeys: false,
        probability: 100,
        recursive: false,
        noRecursiveSearch: false,
        ...overrides,
        scopeType: 'user',
        scopeId: 'user-1'
    });

    const createMockMessages = (contents: string[]): PagedMessages =>
        ({
            length: contents.length,
            slice: vi.fn().mockResolvedValue(
                contents.map((content, i) => ({
                    message: {
                        id: `msg-${i}`,
                        role: 'user',
                        swipes: {
                            [`swipe-${i}`]: {
                                id: `swipe-${i}`,
                                content,
                                variables: {},
                                createdAt: 1
                            }
                        },
                        activeSwipeId: `swipe-${i}`,
                        sortOrder: `order-${i}`,
                        chatId: 'chat-1'
                    },
                    index: i
                }))
            )
        }) as unknown as PagedMessages;

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should activate lorebook if key exists in chat history within scanDepth', async () => {
        const lorebooks = [createMockLorebook({ key: 'apple', scanDepth: 1 })];
        const messages = createMockMessages(['apple', 'banana']);

        const resolved = await resolveLorebookEntries({
            lorebooks,
            messages,
            defaultScanDepth: 5,
            templateCtx: mockTemplateCtx
        });

        // Last message is 'banana', scanDepth is 1, so 'apple' should NOT be found
        expect(resolved).toHaveLength(0);

        const messages2 = createMockMessages(['banana', 'apple']);
        const resolved2 = await resolveLorebookEntries({
            lorebooks,
            messages: messages2,
            defaultScanDepth: 5,
            templateCtx: mockTemplateCtx
        });

        // Last message is 'apple', so it should be found
        expect(resolved2).toHaveLength(1);
        expect(resolved2[0].key).toBe('apple');
    });

    it('should handle recursive activation across multiple rounds', async () => {
        const lorebooks = [
            createMockLorebook({
                id: 'A',
                key: 'apple',
                content: 'trigger_banana',
                recursive: true
            }),
            createMockLorebook({ id: 'B', key: 'trigger_banana', content: 'final_content' })
        ];
        const messages = createMockMessages(['I like apple']);

        const resolved = await resolveLorebookEntries({
            lorebooks,
            messages,
            defaultScanDepth: 5,
            templateCtx: mockTemplateCtx
        });

        // Round 1: A matches 'apple'
        // Round 2: B matches 'trigger_banana' from A's content
        expect(resolved).toHaveLength(2);
        expect(resolved.map((l) => l.id)).toContain('A');
        expect(resolved.map((l) => l.id)).toContain('B');
    });

    it('should respect noRecursiveSearch flag', async () => {
        const lorebooks = [
            createMockLorebook({
                id: 'A',
                key: 'apple',
                content: 'trigger_banana',
                recursive: true
            }),
            createMockLorebook({ id: 'B', key: 'trigger_banana', noRecursiveSearch: true })
        ];
        const messages = createMockMessages(['apple']);

        const resolved = await resolveLorebookEntries({
            lorebooks,
            messages,
            defaultScanDepth: 5,
            templateCtx: mockTemplateCtx
        });

        // A should be active, but B should NOT because it only looks at history
        expect(resolved).toHaveLength(1);
        expect(resolved[0].id).toBe('A');
    });

    it('should activate with useMultipleKeys only if both keys exist in searchable pool', async () => {
        const lorebooks = [
            createMockLorebook({
                id: 'B',
                key: 'apple',
                secondKey: 'banana',
                useMultipleKeys: true
            })
        ];

        // Only one key exists
        const res1 = await resolveLorebookEntries({
            lorebooks,
            messages: createMockMessages(['apple']),
            defaultScanDepth: 5,
            templateCtx: mockTemplateCtx
        });
        expect(res1).toHaveLength(0);

        // Both keys exist
        const res2 = await resolveLorebookEntries({
            lorebooks,
            messages: createMockMessages(['apple and banana']),
            defaultScanDepth: 5,
            templateCtx: mockTemplateCtx
        });
        expect(res2).toHaveLength(1);
    });

    it('should support cross-source matching for useMultipleKeys', async () => {
        const lorebooks = [
            createMockLorebook({
                id: 'A',
                key: 'apple',
                content: 'banana_source',
                recursive: true
            }),
            createMockLorebook({
                id: 'B',
                key: 'apple',
                secondKey: 'banana_source',
                useMultipleKeys: true
            })
        ];
        const messages = createMockMessages(['apple']);

        const resolved = await resolveLorebookEntries({
            lorebooks,
            messages,
            defaultScanDepth: 5,
            templateCtx: mockTemplateCtx
        });

        // Round 1: A matches 'apple'
        // Round 2: B matches 'apple' (from history) AND 'banana_source' (from A's recursive content)
        expect(resolved).toHaveLength(2);
    });

    it('should respect probability settings', async () => {
        const lorebooks = [
            createMockLorebook({ id: 'A', key: 'apple', probability: 0 }),
            createMockLorebook({ id: 'B', key: 'apple', probability: 100 })
        ];
        const messages = createMockMessages(['apple']);

        const resolved = await resolveLorebookEntries({
            lorebooks,
            messages,
            defaultScanDepth: 5,
            templateCtx: mockTemplateCtx
        });

        expect(resolved).toHaveLength(1);
        expect(resolved[0].id).toBe('B');
    });

    it('should handle regex matching correctly', async () => {
        const lorebooks = [
            createMockLorebook({ key: 'ap+le', useRegex: true }),
            createMockLorebook({ key: 'orange', useRegex: true })
        ];
        const messages = createMockMessages(['appple']);

        const resolved = await resolveLorebookEntries({
            lorebooks,
            messages,
            defaultScanDepth: 5,
            templateCtx: mockTemplateCtx
        });

        expect(resolved).toHaveLength(1);
        expect(resolved[0].key).toBe('ap+le');
    });
});
