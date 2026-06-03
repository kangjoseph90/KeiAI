import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RoomService } from '$lib/services/content/room';
import type { DataRecord } from '$lib/adapters/db/types';

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
        getAll: vi.fn(),
        putRecord: vi.fn(),
        getByIndex: vi.fn(),
        transaction: vi.fn(),
        softDeleteRecord: vi.fn(),
        softDeleteByIndex: vi.fn()
    }
}));

vi.mock('$lib/utils/id', () => ({
    generateId: vi.fn(() => 'room-new')
}));

vi.mock('$lib/utils/defaults', () => ({
    deepMerge: vi.fn((target: unknown, source: unknown) => ({
        ...(target as Record<string, unknown>),
        ...(source as Record<string, unknown>)
    }))
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
import { buffer } from '$lib/services/content/record_buffer';

describe('RoomService', () => {
    const mockUserId = 'user-123';

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(buffer.get).mockResolvedValue(null);
        vi.mocked(buffer.flushTable).mockResolvedValue(undefined);
    });

    it('lists rooms for the active user with defaults', async () => {
        vi.mocked(localDB.getAll).mockResolvedValue([
            {
                id: 'room-1',
                scopeType: 'user',
                scopeId: mockUserId,
                isDeleted: false,
                data: { name: 'Room 1' }
            },
            {
                id: 'room-2',
                scopeType: 'user',
                scopeId: mockUserId,
                isDeleted: false,
                data: {}
            }
        ] as unknown as DataRecord[]);

        const rooms = await RoomService.list();

        expect(localDB.getAll).toHaveBeenCalledWith('rooms', {
            scopeType: 'user',
            scopeId: mockUserId
        });
        expect(rooms[0]).toMatchObject({
            id: 'room-1',
            name: 'Room 1',
            chats: { refs: {}, folders: {} },
            characters: { refs: {}, folders: {} }
        });
        expect(rooms[1]).toMatchObject({ id: 'room-2', name: 'New Room' });
    });

    it('returns null for missing, deleted, or inaccessible rooms', async () => {
        vi.mocked(buffer.get).mockResolvedValue(null);
        await expect(RoomService.get('missing')).resolves.toBeNull();

        vi.mocked(buffer.get).mockResolvedValue({
            id: 'room-1',
            scopeType: 'user',
            scopeId: mockUserId,
            isDeleted: true,
            data: {}
        } as never);
        await expect(RoomService.get('room-1')).resolves.toBeNull();

        vi.mocked(buffer.get).mockResolvedValue({
            id: 'room-1',
            scopeType: 'user',
            scopeId: 'other-user',
            isDeleted: false,
            data: {}
        } as never);
        await expect(RoomService.get('room-1')).resolves.toBeNull();
    });

    it('allows reading accessible room-scoped rooms', async () => {
        vi.mocked(buffer.get).mockResolvedValue({
            id: 'room-1',
            scopeType: 'room',
            scopeId: 'room-123',
            isDeleted: false,
            data: { name: 'Multi Room' }
        } as never);

        await expect(RoomService.get('room-1')).resolves.toMatchObject({
            id: 'room-1',
            name: 'Multi Room'
        });
    });

    it('creates a room owned by the active user', async () => {
        const room = await RoomService.create({ name: 'New Project' });

        expect(room).toMatchObject({
            id: 'room-new',
            name: 'New Project',
            chats: { refs: {}, folders: {} },
            characters: { refs: {}, folders: {} }
        });
        expect(localDB.putRecord).toHaveBeenCalledWith(
            'rooms',
            expect.objectContaining({
                id: 'room-new',
                scopeType: 'user',
                scopeId: mockUserId,
                data: expect.objectContaining({ name: 'New Project' })
            })
        );
    });

    it('updates room fields through the record buffer', async () => {
        vi.mocked(buffer.get).mockResolvedValue({
            id: 'room-1',
            scopeType: 'user',
            scopeId: mockUserId,
            isDeleted: false,
            data: { name: 'Old Room' }
        } as never);

        const updated = await RoomService.update('room-1', { name: 'New Room' });

        expect(updated).toMatchObject({ id: 'room-1', name: 'New Room' });
        expect(buffer.update).toHaveBeenCalledWith(
            expect.objectContaining({
                tableName: 'rooms',
                patch: { name: 'New Room' }
            })
        );
    });

    it('updates accessible room-scoped rooms', async () => {
        vi.mocked(buffer.get).mockResolvedValue({
            id: 'room-1',
            scopeType: 'room',
            scopeId: 'room-123',
            isDeleted: false,
            data: { name: 'Old Multi Room' }
        } as never);

        const updated = await RoomService.update('room-1', { name: 'New Multi Room' });

        expect(updated).toMatchObject({ id: 'room-1', name: 'New Multi Room' });
        expect(buffer.update).toHaveBeenCalledWith(
            expect.objectContaining({
                tableName: 'rooms',
                patch: { name: 'New Multi Room' }
            })
        );
    });

    it('does not delete room-scoped rooms through the personal room service path', async () => {
        vi.mocked(buffer.get).mockResolvedValue({
            id: 'room-1',
            scopeType: 'room',
            scopeId: 'room-123',
            isDeleted: false,
            data: { name: 'Multi Room' }
        } as never);

        await expect(RoomService.delete('room-1')).rejects.toThrow();
    });

    it('cascade soft-deletes room chats and chat-owned runtime data', async () => {
        vi.mocked(buffer.get).mockResolvedValue({
            id: 'room-1',
            scopeType: 'user',
            scopeId: mockUserId,
            isDeleted: false,
            data: { name: 'Delete Me' }
        } as never);
        vi.mocked(localDB.getByIndex).mockImplementation(async (table: string) => {
            if (table === 'chats') {
                return [
                    { id: 'chat-1', isDeleted: false },
                    { id: 'chat-2', isDeleted: false }
                ] as unknown as DataRecord[];
            }
            return [] as unknown as DataRecord[];
        });
        vi.mocked(localDB.transaction).mockImplementation(async (_tables, _mode, callback) => {
            await callback();
        });

        await RoomService.delete('room-1');

        expect(localDB.transaction).toHaveBeenCalledWith(
            expect.arrayContaining([
                'rooms',
                'chats',
                'lorebooks',
                'scripts',
                'messages',
                'tool_calls',
                'translations'
            ]),
            'rw',
            expect.any(Function)
        );
        expect(localDB.getByIndex).toHaveBeenCalledWith('chats', 'roomId', 'room-1', Infinity);
        expect(localDB.softDeleteByIndex).toHaveBeenCalledWith(
            'chats',
            'roomId',
            'room-1',
            undefined
        );
        expect(localDB.softDeleteRecord).toHaveBeenCalledWith('rooms', 'room-1');
    });
});
