import { RecordScopeService } from '$lib/services';
import { AppError } from '$lib/types/errors';
import { selectCharacter, selectMultiRoom, selectPersona, selectRoom } from '$lib/stores';

export async function restoreRoomContext(roomId: string): Promise<void> {
    const scope = await RecordScopeService.resolve('rooms', roomId);
    if (scope?.scopeType === 'user') {
        await selectRoom(roomId);
        return;
    }
    if (scope?.scopeType === 'room' || scope === null) {
        await selectMultiRoom(scope?.scopeId ?? roomId);
        return;
    }
    throw new AppError('NOT_FOUND', `Room not found: ${roomId}`);
}

export async function restoreCharacterContext(characterId: string): Promise<void> {
    const scope = await RecordScopeService.resolve('characters', characterId);
    if (!scope) throw new AppError('NOT_FOUND', `Character not found: ${characterId}`);
    if (scope.scopeType === 'room') {
        await selectMultiRoom(scope.scopeId);
    }
    await selectCharacter(characterId);
}

export async function restorePersonaContext(personaId: string): Promise<void> {
    const scope = await RecordScopeService.resolve('personas', personaId);
    if (!scope) throw new AppError('NOT_FOUND', `Persona not found: ${personaId}`);
    if (scope.scopeType === 'room') {
        await selectMultiRoom(scope.scopeId);
    }
    await selectPersona(personaId);
}
