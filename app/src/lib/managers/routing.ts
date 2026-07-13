import { RecordScopeService } from '$lib/services';
import { AppError } from '$lib/types/errors';
import { selectCharacter, selectMultiRoom, selectPersona, selectRoom } from '$lib/stores';

export async function restoreRoomContext(
    roomId: string,
    isContextCurrent?: () => boolean
): Promise<void> {
    const isCurrent = isContextCurrent ?? (() => true);
    const scope = await RecordScopeService.resolve('rooms', roomId);
    if (!isCurrent()) return;
    if (scope?.scopeType === 'user') {
        await selectRoom(roomId, isCurrent);
        return;
    }
    if (scope?.scopeType === 'room' || scope === null) {
        const targetRoomId = scope?.scopeId ?? roomId;
        await selectMultiRoom(targetRoomId, isCurrent);
        return;
    }
    throw new AppError('NOT_FOUND', `Room not found: ${roomId}`);
}

export async function restoreCharacterContext(
    characterId: string,
    isContextCurrent?: () => boolean
): Promise<void> {
    const isCurrent = isContextCurrent ?? (() => true);
    const scope = await RecordScopeService.resolve('characters', characterId);
    if (!isCurrent()) return;
    if (!scope) throw new AppError('NOT_FOUND', `Character not found: ${characterId}`);
    if (scope.scopeType === 'room') {
        await selectMultiRoom(scope.scopeId, isCurrent);
        if (!isCurrent()) return;
    }
    await selectCharacter(characterId, isCurrent);
}

export async function restorePersonaContext(
    personaId: string,
    isContextCurrent?: () => boolean
): Promise<void> {
    const isCurrent = isContextCurrent ?? (() => true);
    const scope = await RecordScopeService.resolve('personas', personaId);
    if (!isCurrent()) return;
    if (!scope) throw new AppError('NOT_FOUND', `Persona not found: ${personaId}`);
    if (scope.scopeType === 'room') {
        await selectMultiRoom(scope.scopeId, isCurrent);
        if (!isCurrent()) return;
    }
    await selectPersona(personaId, isCurrent);
}
