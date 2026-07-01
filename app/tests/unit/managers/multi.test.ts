import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addChatPersonaFromLibrary, addRoomCharacterFromLibrary } from '$lib/managers/multi';
import {
    addChatPersona,
    addRoomCharacter,
    getChat,
    getRoom,
    importCharacterPackage,
    importPersonaPackage
} from '$lib/stores';
import { exportCharacterPackage } from '$lib/porters/character';
import { exportPersonaPackage } from '$lib/porters/persona';

vi.mock('$lib/stores', () => ({
    addChatPersona: vi.fn(),
    addRoomCharacter: vi.fn(),
    getChat: vi.fn(),
    getRoom: vi.fn(),
    importCharacterPackage: vi.fn(),
    importPersonaPackage: vi.fn()
}));

vi.mock('$lib/porters/character', () => ({ exportCharacterPackage: vi.fn() }));
vi.mock('$lib/porters/persona', () => ({ exportPersonaPackage: vi.fn() }));

describe('multi-room library copy managers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getRoom).mockResolvedValue({
            id: 'room-1',
            scopeType: 'room',
            scopeId: 'room-1'
        } as Awaited<ReturnType<typeof getRoom>>);
    });

    it('copies a library character into room scope and attaches it', async () => {
        const pkg = { version: 1 } as Awaited<ReturnType<typeof exportCharacterPackage>>;
        vi.mocked(exportCharacterPackage).mockResolvedValue(pkg);
        vi.mocked(importCharacterPackage).mockResolvedValue({
            id: 'room-char-1'
        } as Awaited<ReturnType<typeof importCharacterPackage>>);

        const result = await addRoomCharacterFromLibrary('room-1', 'library-char-1');

        expect(exportCharacterPackage).toHaveBeenCalledWith('library-char-1', 'baked');
        expect(importCharacterPackage).toHaveBeenCalledWith(pkg, { allowLightAssets: false });
        expect(addRoomCharacter).toHaveBeenCalledWith('room-1', 'room-char-1');
        expect(result).toBe('room-char-1');
    });

    it('copies a library persona into room scope and attaches it to the chat', async () => {
        const pkg = { version: 1 } as Awaited<ReturnType<typeof exportPersonaPackage>>;
        vi.mocked(getChat).mockResolvedValue({
            id: 'chat-1',
            roomId: 'room-1'
        } as Awaited<ReturnType<typeof getChat>>);
        vi.mocked(exportPersonaPackage).mockResolvedValue(pkg);
        vi.mocked(importPersonaPackage).mockResolvedValue({
            id: 'room-persona-1'
        } as Awaited<ReturnType<typeof importPersonaPackage>>);

        const result = await addChatPersonaFromLibrary('chat-1', 'library-persona-1');

        expect(exportPersonaPackage).toHaveBeenCalledWith('library-persona-1', 'baked');
        expect(importPersonaPackage).toHaveBeenCalledWith(pkg, { allowLightAssets: false });
        expect(addChatPersona).toHaveBeenCalledWith('chat-1', 'room-persona-1');
        expect(result).toBe('room-persona-1');
    });

    it('rejects copying into a user-scoped room', async () => {
        vi.mocked(getRoom).mockResolvedValue({
            id: 'room-1',
            scopeType: 'user',
            scopeId: 'user-1'
        } as Awaited<ReturnType<typeof getRoom>>);

        await expect(addRoomCharacterFromLibrary('room-1', 'char-1')).rejects.toThrow(
            'Room is not a multi room'
        );
    });
});
