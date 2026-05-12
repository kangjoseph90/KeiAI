import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RoomService } from '$lib/services/content/room';
import type { BaseRecord } from '$lib/adapters/db/types';

vi.mock('$lib/services/user', () => ({
    getActiveSession: vi.fn()
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

import { getActiveSession } from '$lib/services/user';
import { localDB } from '$lib/adapters/db';
import { buffer } from '$lib/services/content/record_buffer';

describe('RoomService', () => {
    const mockUserId = 'user-123';

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getActiveSession).mockReturnValue({
            masterKey: {} as CryptoKey,
            userId: mockUserId,
            identityKeyPair: {} as CryptoKeyPair
        });
        vi.mocked(buffer.get).mockResolvedValue(null);
        vi.mocked(buffer.flushTable).mockResolvedValue(undefined);
    });

    it('lists rooms for the active user with defaults', async () => {
        vi.mocked(localDB.getAll).mockResolvedValue([
            {
                id: 'room-1',
                userId: mockUserId,
                isDeleted: false,
                data: { name: 'Room 1' }
            },
            {
                id: 'room-2',
                userId: mockUserId,
                isDeleted: false,
                data: {}
            }
        ] as unknown as BaseRecord[]);

        const rooms = await RoomService.list();

        expect(localDB.getAll).toHaveBeenCalledWith('rooms', mockUserId);
        expect(rooms[0]).toMatchObject({
            id: 'room-1',
            name: 'Room 1',
            chats: { refs: {}, folders: {} },
            characters: { refs: {}, folders: {} }
        });
        expect(rooms[1]).toMatchObject({ id: 'room-2', name: 'New Room' });
    });

    it('returns null for missing, deleted, or foreign rooms', async () => {
        vi.mocked(buffer.get).mockResolvedValue(null);
        await expect(RoomService.get('missing')).resolves.toBeNull();

        vi.mocked(buffer.get).mockResolvedValue({
            id: 'room-1',
            userId: mockUserId,
            isDeleted: true,
            data: {}
        } as never);
        await expect(RoomService.get('room-1')).resolves.toBeNull();

        vi.mocked(buffer.get).mockResolvedValue({
            id: 'room-1',
            userId: 'other-user',
            isDeleted: false,
            data: {}
        } as never);
        await expect(RoomService.get('room-1')).resolves.toBeNull();
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
                userId: mockUserId,
                data: expect.objectContaining({ name: 'New Project' })
            })
        );
    });

    it('updates room fields through the record buffer', async () => {
        vi.mocked(buffer.get).mockResolvedValue({
            id: 'room-1',
            userId: mockUserId,
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

    it('cascade soft-deletes room chats and chat-owned runtime data', async () => {
        vi.mocked(buffer.get).mockResolvedValue({
            id: 'room-1',
            userId: mockUserId,
            isDeleted: false,
            data: { name: 'Delete Me' }
        } as never);
        vi.mocked(localDB.getByIndex).mockResolvedValue([
            { id: 'chat-1' },
            { id: 'chat-2' }
        ] as unknown as BaseRecord[]);
        vi.mocked(localDB.transaction).mockImplementation(async (_tables, _mode, callback) => {
            await callback();
        });

        await RoomService.delete('room-1');

        expect(localDB.transaction).toHaveBeenCalledWith(
            ['chats', 'messages', 'tool_calls', 'translations', 'rooms'],
            'rw',
            expect.any(Function)
        );
        expect(localDB.getByIndex).toHaveBeenCalledWith(
            'chats',
            'roomId',
            'room-1',
            Number.MAX_SAFE_INTEGER
        );
        expect(localDB.softDeleteByIndex).toHaveBeenCalledWith('messages', 'chatId', 'chat-1');
        expect(localDB.softDeleteByIndex).toHaveBeenCalledWith('tool_calls', 'chatId', 'chat-1');
        expect(localDB.softDeleteByIndex).toHaveBeenCalledWith('translations', 'chatId', 'chat-1');
        expect(localDB.softDeleteByIndex).toHaveBeenCalledWith('messages', 'chatId', 'chat-2');
        expect(localDB.softDeleteByIndex).toHaveBeenCalledWith('chats', 'roomId', 'room-1');
        expect(localDB.softDeleteRecord).toHaveBeenCalledWith('rooms', 'room-1');
    });
});
