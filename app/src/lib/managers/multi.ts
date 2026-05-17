import {
    addChatPersona,
    addRoomCharacter,
    getChat,
    getRoom,
    importCharacterPackage,
    importPersonaPackage
} from '$lib/stores';
import { exportCharacterPackage } from '$lib/porters/character';
import { exportPersonaToKei } from '$lib/porters/persona';
import { AppError } from '$lib/types/errors';

export async function addRoomCharacterFromLibrary(
    roomId: string,
    characterId: string
): Promise<string> {
    const room = await getRoom(roomId);
    if (!room) throw new AppError('NOT_FOUND', `Room not found: ${roomId}`);
    if (room.scopeType !== 'room') {
        throw new AppError('INVALID_INPUT', `Room is not a multi room: ${roomId}`);
    }

    const pkg = await exportCharacterPackage(characterId, 'light');
    const character = await importCharacterPackage(pkg, {
        allowLightAssets: true
    });

    await addRoomCharacter(roomId, character.id);
    return character.id;
}

export async function addChatPersonaFromLibrary(
    chatId: string,
    personaId: string
): Promise<string> {
    const chat = await getChat(chatId);
    if (!chat) throw new AppError('NOT_FOUND', `Chat not found: ${chatId}`);

    const room = await getRoom(chat.roomId);
    if (!room) throw new AppError('NOT_FOUND', `Room not found: ${chat.roomId}`);
    if (room.scopeType !== 'room') {
        throw new AppError('INVALID_INPUT', `Room is not a multi room: ${chat.roomId}`);
    }

    const pkg = await exportPersonaToKei(personaId, { mode: 'light' });
    const persona = await importPersonaPackage(pkg, {
        allowLightAssets: true
    });

    await addChatPersona(chatId, persona.id);
    return persona.id;
}
