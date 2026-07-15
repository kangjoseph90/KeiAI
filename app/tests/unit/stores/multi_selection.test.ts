import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { selectMultiRoom } from '$lib/stores/content/multi';
import { activeRoomId, isMultiRoom } from '$lib/stores/state';
import { MultiRoomService } from '$lib/services';

const session = vi.hoisted(() => ({ roomId: undefined as string | undefined }));

vi.mock('$lib/services/session', () => ({
    getActiveSession: vi.fn(() => ({ userId: 'user-1', ...session })),
    hasActiveSession: vi.fn(() => true)
}));

vi.mock('$lib/services', () => ({
    CharacterService: { list: vi.fn() },
    ChatService: { listByRoom: vi.fn() },
    MultiRoomService: {
        openRoom: vi.fn(),
        closeRoom: vi.fn(() => {
            session.roomId = undefined;
        }),
        listMembers: vi.fn()
    },
    PersonaService: { list: vi.fn() },
    RoomService: { get: vi.fn() }
}));

vi.mock('$lib/stores/content/room', () => ({
    clearActiveRoom: vi.fn(),
    scheduleRoomSelection: vi.fn(
        (operation: (isCurrent: () => boolean) => Promise<void>, isCurrent: () => boolean) =>
            operation(isCurrent)
    ),
    updateRoom: vi.fn()
}));

vi.mock('$lib/stores/content/chat', () => ({
    ensureRoomHasChat: vi.fn(),
    selectChat: vi.fn()
}));

vi.mock('$lib/stores/content/settings', () => ({
    getAppSettings: vi.fn(),
    updateSettings: vi.fn()
}));

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((innerResolve) => {
        resolve = innerResolve;
    });
    return { promise, resolve };
}

describe('multi-room selection session ownership', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        session.roomId = undefined;
        activeRoomId.set(null);
        isMultiRoom.set(false);
    });

    it('closes a session whose open finishes after navigation is superseded', async () => {
        const opening = deferred<{ id: string; ownerUserId: string }>();
        let contextCurrent = true;
        vi.mocked(MultiRoomService.openRoom).mockImplementation(async () => {
            const meta = await opening.promise;
            session.roomId = meta.id;
            return meta as Awaited<ReturnType<typeof MultiRoomService.openRoom>>;
        });

        const selection = selectMultiRoom('room-1', () => contextCurrent);
        contextCurrent = false;
        opening.resolve({ id: 'room-1', ownerUserId: 'user-1' });
        await selection;

        expect(MultiRoomService.closeRoom).toHaveBeenCalledOnce();
        expect(session.roomId).toBeUndefined();
        expect(get(activeRoomId)).toBeNull();
    });
});
