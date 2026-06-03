/**
 * Message Service Tests
 *
 * Tests the MessageService which handles message CRUD operations
 * with pagination, and fractional indexing for sortOrder.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageService } from '$lib/services/content/message';
import type { MessageFields } from '$lib/services/content/message';
import type { DataRecord } from '$lib/adapters/db/types';

// Mock all dependencies
vi.mock('$lib/services/session', () => ({
    getSessionScope: vi.fn((scopeType: 'user' | 'room') => {
        if (scopeType === 'user') return { scopeType: 'user', scopeId: 'user-123' };
        return { scopeType: 'room', scopeId: 'room-123' };
    }),
    canAccessScope: vi.fn((record: { scopeType: string; scopeId: string }) => {
        return (
            (record.scopeType === 'user' && record.scopeId === 'user-123') ||
            (record.scopeType === 'room' && record.scopeId === 'room-123')
        );
    })
}));

vi.mock('$lib/adapters/db', () => ({
    localDB: {
        getRecordsBackward: vi.fn(),
        getRecordsForward: vi.fn(),
        getRecord: vi.fn(),
        putRecord: vi.fn(),
        softDeleteRecord: vi.fn(),
        softDeleteByIndex: vi.fn(),
        softDeleteByCompoundIndex: vi.fn(),
        getByIndex: vi.fn(),
        countByIndex: vi.fn(),
        countRecordsInRange: vi.fn(),
        transaction: vi.fn()
    }
}));

vi.mock('$lib/utils/id', () => ({
    generateId: vi.fn(() => 'test-msg-id')
}));

vi.mock('$lib/utils/defaults', () => ({
    deepMerge: vi.fn((target: unknown, source: unknown) => {
        if (
            typeof target === 'object' &&
            target !== null &&
            typeof source === 'object' &&
            source !== null
        ) {
            return { ...target, ...source };
        }
        return source ?? target;
    })
}));

vi.mock('fractional-indexing', () => ({
    generateKeyBetween: vi.fn((a: string | null, b: string | null) => 'a0')
}));

vi.mock('$lib/services/content/record_buffer', () => ({
    buffer: {
        get: vi.fn(),
        update: vi.fn(),
        drop: vi.fn(),
        flushTable: vi.fn()
    }
}));

import { localDB } from '$lib/adapters/db';
import { generateId } from '$lib/utils/id';
import { generateKeyBetween } from 'fractional-indexing';
import { buffer } from '$lib/services/content/record_buffer';

// Helper to create a minimal MessageFields payload
function makeFields(content: string, role: MessageFields['role'] = 'user'): MessageFields {
    return {
        role,
        swipes: {
            s1: { id: 's1', content, createdAt: 1000 }
        },
        activeSwipeId: 's1'
    };
}

describe('MessageService', () => {
    const mockUserId = 'user-123';

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(buffer.get).mockResolvedValue(null);
        vi.mocked(buffer.flushTable).mockResolvedValue(undefined);

        // Default generateId mock
        vi.mocked(generateId).mockReturnValue('test-msg-id');

        // Default generateKeyBetween mock
        vi.mocked(generateKeyBetween).mockReturnValue('a0');

        vi.mocked(localDB.transaction).mockImplementation(async (_tables, _mode, callback) =>
            callback()
        );
    });

    describe('getMessagesBefore (pagination)', () => {
        it('should return messages before a cursor (older messages)', async () => {
            const mockRecords = [
                {
                    id: 'msg-2',
                    chatId: 'chat-1',
                    sortOrder: 'a1',
                    scopeType: 'user',
                    scopeId: mockUserId,
                    createdAt: 2000,
                    updatedAt: 2000,
                    isDeleted: false,
                    data: makeFields('Msg 2', 'assistant')
                } as unknown as DataRecord,
                {
                    id: 'msg-1',
                    chatId: 'chat-1',
                    sortOrder: 'a0',
                    scopeType: 'user',
                    scopeId: mockUserId,
                    createdAt: 1000,
                    updatedAt: 1000,
                    isDeleted: false,
                    data: makeFields('Msg 1')
                } as unknown as DataRecord
            ] as DataRecord[];

            vi.mocked(localDB.getRecordsBackward).mockResolvedValue(mockRecords);

            const result = await MessageService.getMessagesBefore('chat-1', 'a1', 10);

            expect(result).toHaveLength(2);
            expect(result[0].id).toBe('msg-1');
            expect(result[1].id).toBe('msg-2');
        });
    });

    describe('get', () => {
        it('should return a message by id', async () => {
            const mockRecord = {
                id: 'msg-1',
                chatId: 'chat-1',
                sortOrder: 'a0',
                scopeType: 'user',
                scopeId: mockUserId,
                createdAt: 1000,
                updatedAt: 1000,
                isDeleted: false,
                data: makeFields('Hello')
            } as unknown as DataRecord;

            vi.mocked(buffer.get).mockResolvedValue(mockRecord as never);

            const result = await MessageService.get('msg-1');

            expect(result).not.toBeNull();
            expect(result?.id).toBe('msg-1');
            expect(result?.role).toBe('user');
            expect(result!.swipes[result!.activeSwipeId].content).toBe('Hello');
        });
    });

    describe('create', () => {
        it('should create a message with auto-generated sortOrder', async () => {
            vi.mocked(localDB.getRecordsBackward).mockResolvedValue([]);
            vi.mocked(generateKeyBetween).mockReturnValue('a0');

            const result = await MessageService.create('chat-1', makeFields('Hi'));

            expect(result.id).toBe('test-msg-id');
            expect(result.chatId).toBe('chat-1');
            expect(result.role).toBe('user');
            expect(result.swipes[result.activeSwipeId].content).toBe('Hi');
            expect(result.sortOrder).toBe('a0');

            expect(generateKeyBetween).toHaveBeenCalledWith(null, null);
            expect(localDB.putRecord).toHaveBeenCalledWith(
                'messages',
                expect.objectContaining({
                    id: 'test-msg-id',
                    scopeType: 'user',
                    scopeId: mockUserId,
                    chatId: 'chat-1'
                })
            );
        });

        it('should create a room-scoped message when requested explicitly', async () => {
            vi.mocked(generateKeyBetween).mockReturnValue('a0');

            const result = await MessageService.create(
                'chat-1',
                makeFields('Hi shared'),
                undefined,
                'room'
            );

            expect(result.id).toBe('test-msg-id');
            expect(localDB.putRecord).toHaveBeenCalledWith(
                'messages',
                expect.objectContaining({
                    id: 'test-msg-id',
                    scopeType: 'room',
                    scopeId: 'room-123',
                    chatId: 'chat-1'
                })
            );
        });
    });

    describe('update', () => {
        it('should update message swipes via write queue', async () => {
            const existingRecord = {
                id: 'msg-1',
                chatId: 'chat-1',
                sortOrder: 'a0',
                scopeType: 'user',
                scopeId: mockUserId,
                createdAt: 1000,
                updatedAt: 1000,
                isDeleted: false,
                data: makeFields('Old')
            } as unknown as DataRecord;

            vi.mocked(buffer.get).mockResolvedValue(existingRecord as never);

            const result = await MessageService.update('msg-1', {
                swipes: { s1: { id: 's1', content: 'New content', createdAt: 2000 } }
            });

            expect(result.swipes[result.activeSwipeId].content).toBe('New content');
            expect(localDB.putRecord).not.toHaveBeenCalled();
        });
    });

    describe('swipe lifecycle', () => {
        const existingRecord = {
            id: 'msg-1',
            chatId: 'chat-1',
            sortOrder: 'a0',
            scopeType: 'user',
            scopeId: mockUserId,
            createdAt: 1000,
            updatedAt: 1000,
            isDeleted: false,
            data: {
                role: 'assistant',
                activeSwipeId: 's1',
                swipes: {
                    s1: { id: 's1', content: 'keep', createdAt: 1000 },
                    s2: {
                        id: 's2',
                        content: 'remove',
                        createdAt: 1000
                    }
                }
            }
        } as unknown as DataRecord;

        beforeEach(() => {
            vi.mocked(buffer.get).mockResolvedValue(existingRecord as never);
            vi.mocked(localDB.getByIndex).mockResolvedValue([]);
        });

        it('deleteSwipe deletes swipe artifacts and removes the swipe', async () => {
            const result = await MessageService.deleteSwipe('msg-1', 's2');

            expect(localDB.softDeleteByCompoundIndex).toHaveBeenCalledWith(
                'tool_calls',
                '[messageId+swipeId]',
                ['msg-1', 's2']
            );
            expect(localDB.softDeleteByCompoundIndex).toHaveBeenCalledWith(
                'translations',
                '[messageId+swipeId]',
                ['msg-1', 's2']
            );
            expect(buffer.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    tableName: 'messages',
                    record: expect.objectContaining({
                        id: 'msg-1',
                        data: expect.objectContaining({
                            activeSwipeId: 's1'
                        })
                    })
                })
            );
            expect(result.swipes.s2).toBeUndefined();
        });

        it('deleteSwipe moves activeSwipeId when deleting the active swipe', async () => {
            const result = await MessageService.deleteSwipe('msg-1', 's1');

            expect(buffer.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    tableName: 'messages',
                    record: expect.objectContaining({
                        id: 'msg-1',
                        data: expect.objectContaining({
                            activeSwipeId: 's2'
                        })
                    })
                })
            );
            expect(result.activeSwipeId).toBe('s2');
            expect(result.swipes.s1).toBeUndefined();
        });

        it('createSwipe appends a swipe without changing active swipe', async () => {
            const result = await MessageService.createSwipe('msg-1', {
                content: 'New'
            });

            expect(result.swipeId).toBe('test-msg-id');
            expect(result.message.swipes['test-msg-id'].content).toBe('New');
            expect(result.message.activeSwipeId).toBe('s1');
        });

        it('updateSwipe updates requested swipe', async () => {
            const result = await MessageService.updateSwipe('msg-1', 's1', {
                content: 'New'
            });

            expect(result.swipes.s1.content).toBe('New');
        });
    });
});
