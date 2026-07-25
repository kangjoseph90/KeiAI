import { get } from 'svelte/store';
import { RecordScopeService } from '$lib/services';
import { AppError } from '$lib/types/errors';
import {
    selectCharacter,
    selectModule,
    selectMultiRoom,
    selectPersona,
    selectRoom
} from '$lib/stores';
import {
    navigate,
    route,
    type CharacterStudioTab,
    type ModuleStudioTab,
    type PersonaStudioTab,
    type RouteState
} from '$lib/router';

async function navigateAfterPreparation(
    target: RouteState,
    prepare: (isCurrent: () => boolean) => Promise<void>
): Promise<void> {
    const origin = get(route);
    const isCurrent = () => get(route) === origin;
    await prepare(isCurrent);
    if (isCurrent()) navigate(target);
}

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

export function navigateToCharacterStudio(
    characterId: string,
    characterTab?: CharacterStudioTab
): Promise<void> {
    return navigateAfterPreparation(
        { view: 'characterStudio', charId: characterId, characterTab },
        (isCurrent) => restoreCharacterContext(characterId, isCurrent)
    );
}

export function navigateToPersonaStudio(
    personaId: string,
    personaTab?: PersonaStudioTab
): Promise<void> {
    return navigateAfterPreparation({ view: 'personaStudio', personaId, personaTab }, (isCurrent) =>
        restorePersonaContext(personaId, isCurrent)
    );
}

export function navigateToModuleStudio(
    moduleId: string,
    moduleTab?: ModuleStudioTab
): Promise<void> {
    return navigateAfterPreparation({ view: 'moduleStudio', moduleId, moduleTab }, (isCurrent) =>
        selectModule(moduleId, isCurrent)
    );
}
