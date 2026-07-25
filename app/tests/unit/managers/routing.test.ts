import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    restoreCharacterContext,
    restorePersonaContext,
    restoreRoomContext
} from '$lib/managers/routing';
import { RecordScopeService } from '$lib/services';
import { selectCharacter, selectMultiRoom, selectPersona, selectRoom } from '$lib/stores';

vi.mock('$lib/services', () => ({
    RecordScopeService: { resolve: vi.fn() }
}));

vi.mock('$lib/stores', () => ({
    selectCharacter: vi.fn(),
    selectModule: vi.fn(),
    selectMultiRoom: vi.fn(),
    selectPersona: vi.fn(),
    selectRoom: vi.fn()
}));

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((innerResolve) => {
        resolve = innerResolve;
    });
    return { promise, resolve };
}

describe('routing context restoration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('restores user and room routes with the matching selector', async () => {
        vi.mocked(RecordScopeService.resolve)
            .mockResolvedValueOnce({ scopeType: 'user', scopeId: 'user-1' })
            .mockResolvedValueOnce({ scopeType: 'room', scopeId: 'multi-1' });

        await restoreRoomContext('room-1');
        await restoreRoomContext('multi-1');

        expect(selectRoom).toHaveBeenCalledWith('room-1', expect.any(Function));
        expect(selectMultiRoom).toHaveBeenCalledWith('multi-1', expect.any(Function));
    });

    it('tries a multi-room restore when a room record is not local yet', async () => {
        vi.mocked(RecordScopeService.resolve).mockResolvedValue(null);

        await restoreRoomContext('multi-1');

        expect(selectMultiRoom).toHaveBeenCalledWith('multi-1', expect.any(Function));
    });

    it('opens the room session before a room-scoped studio resource', async () => {
        vi.mocked(RecordScopeService.resolve)
            .mockResolvedValueOnce({ scopeType: 'room', scopeId: 'multi-1' })
            .mockResolvedValueOnce({ scopeType: 'room', scopeId: 'multi-1' });

        await restoreCharacterContext('char-1');
        await restorePersonaContext('persona-1');

        expect(selectMultiRoom).toHaveBeenNthCalledWith(1, 'multi-1', expect.any(Function));
        expect(selectCharacter).toHaveBeenCalledWith('char-1', expect.any(Function));
        expect(selectMultiRoom).toHaveBeenNthCalledWith(2, 'multi-1', expect.any(Function));
        expect(selectPersona).toHaveBeenCalledWith('persona-1', expect.any(Function));
    });

    it('opens user-scoped studio resources without a room session', async () => {
        vi.mocked(RecordScopeService.resolve)
            .mockResolvedValueOnce({ scopeType: 'user', scopeId: 'user-1' })
            .mockResolvedValueOnce({ scopeType: 'user', scopeId: 'user-1' });

        await restoreCharacterContext('char-1');
        await restorePersonaContext('persona-1');

        expect(selectMultiRoom).not.toHaveBeenCalled();
        expect(selectCharacter).toHaveBeenCalledWith('char-1', expect.any(Function));
        expect(selectPersona).toHaveBeenCalledWith('persona-1', expect.any(Function));
    });

    it('rejects missing studio resources', async () => {
        vi.mocked(RecordScopeService.resolve).mockResolvedValue(null);

        await expect(restoreCharacterContext('missing')).rejects.toThrow('Character not found');
        await expect(restorePersonaContext('missing')).rejects.toThrow('Persona not found');
    });

    it('does not select a resource after its route becomes stale', async () => {
        const scope = deferred<{ scopeType: 'user'; scopeId: string } | null>();
        let isCurrent = true;
        vi.mocked(RecordScopeService.resolve).mockReturnValue(scope.promise);

        const restoration = restoreCharacterContext('char-1', () => isCurrent);
        isCurrent = false;
        scope.resolve({ scopeType: 'user', scopeId: 'user-1' });
        await restoration;

        expect(selectCharacter).not.toHaveBeenCalled();
    });
});
