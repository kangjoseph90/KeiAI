import { get } from 'svelte/store';
import { PersonaService, type PersonaFields, type Persona } from '$lib/services/content/persona';
import {
    importPersonaPackage as importPersonaPackagePorter,
    type KeiPersonaPackageV1
} from '$lib/porters/persona';
import type { PorterProgressReporter } from '$lib/porters/progress';
import { generateSortOrder, sortByRefs } from '$lib/utils/ordering';
import type { DeepPartial } from '$lib/utils/defaults';
import type { FolderDef } from '$lib/types/refs';
import type { AssetFields } from '$lib/types/asset';
import { generateId } from '$lib/utils/id';
import {
    activePersona,
    activePersonaId,
    activeRoomId,
    isMultiRoom,
    multiRoomPersonas,
    personas
} from '../state';
import { getAppSettings, updateSettings } from './settings';
import { AppError } from '$lib/types/errors';
import type { AppSettings } from '$lib/services';

let personaSelectionVersion = 0;

/**
 * Returns persona from store cache first, then from DB if needed.
 * Returns null if not found.
 */
export async function getPersona(personaId: string): Promise<Persona | null> {
    const active = get(activePersona);
    if (active?.id === personaId) return active;
    const cached = personas.get(personaId);
    if (cached) return cached;
    const cachedMulti = multiRoomPersonas.get(personaId);
    if (cachedMulti?.scopeId === get(activeRoomId)) return cachedMulti;
    const fetched = await PersonaService.get(personaId);
    if (fetched) {
        if (fetched.scopeType === 'user') {
            personas.set(personaId, fetched);
        } else if (fetched.scopeId === get(activeRoomId)) {
            multiRoomPersonas.set(personaId, fetched);
        }
    }
    return fetched;
}

/**
 * Service errors propagate to the caller — this function does not catch them.
 * Callers (e.g. route load functions) are responsible for error boundaries.
 */
export async function loadPersonas(): Promise<void> {
    const settings = await getAppSettings();
    const list = await PersonaService.list();
    personas.setAll(sortByRefs(list, settings.personas.refs));
}

export async function selectPersona(
    personaId: string,
    isContextCurrent: () => boolean = () => true
): Promise<void> {
    if (!isContextCurrent()) return;
    const version = ++personaSelectionVersion;
    activePersonaId.set(null);
    const persona = await getPersona(personaId);
    if (version !== personaSelectionVersion || !isContextCurrent()) return;
    if (!persona) throw new AppError('NOT_FOUND', `Persona not found: ${personaId}`);

    if (persona.scopeType === 'user') {
        personas.set(persona.id, persona);
    } else if (persona.scopeId === get(activeRoomId)) {
        multiRoomPersonas.set(persona.id, persona);
    }
    activePersonaId.set(persona.id);
}

export function clearActivePersona(): void {
    personaSelectionVersion += 1;
    activePersonaId.set(null);
}

export async function createPersona(fields: DeepPartial<PersonaFields> = {}): Promise<Persona> {
    if (get(isMultiRoom)) {
        const persona = await PersonaService.create(fields, 'room');
        multiRoomPersonas.set(persona.id, persona);
        return persona;
    }

    const settings = await getAppSettings();

    // Create Record in DB
    const persona = await PersonaService.create(fields);

    // Add to parent's refs
    const sortOrder = generateSortOrder(settings.personas.refs, settings.personas.folders);
    try {
        await updateSettings({
            personas: { refs: { [persona.id]: { id: persona.id, sortOrder } } }
        });
    } catch (error) {
        // If parent's refs update fails, roll back DB
        await PersonaService.delete(persona.id);
        throw error;
    }

    // Update Store
    personas.set(persona.id, persona);

    return persona;
}

export async function importPersonaPackage(
    pkg: KeiPersonaPackageV1,
    options: {
        allowLightAssets?: boolean;
        select?: boolean;
        onProgress?: PorterProgressReporter;
    } = {}
): Promise<Persona> {
    const scopeType = get(isMultiRoom) ? 'room' : 'user';
    const personaId = await importPersonaPackagePorter(pkg, {
        scopeType,
        allowLightAssets: options.allowLightAssets,
        onProgress: options.onProgress
    });

    const persona = await PersonaService.get(personaId);
    if (!persona) {
        throw new AppError('NOT_FOUND', `Persona not found: ${personaId}`);
    }

    if (persona.scopeType === 'user') {
        const settings = await getAppSettings();
        const sortOrder = generateSortOrder(settings.personas.refs, settings.personas.folders);
        try {
            await updateSettings({
                personas: { refs: { [persona.id]: { id: persona.id, sortOrder } } }
            });
        } catch (error) {
            await PersonaService.delete(persona.id);
            throw error;
        }
        personas.set(persona.id, persona);
    } else if (persona.scopeId === get(activeRoomId)) {
        multiRoomPersonas.set(persona.id, persona);
    }

    if (options.select) {
        await selectPersona(persona.id);
    }

    return persona;
}

export async function updatePersona(
    personaId: string,
    changes: DeepPartial<PersonaFields>
): Promise<void> {
    const updated = await PersonaService.update(personaId, changes);
    if (updated.scopeType === 'user') {
        personas.set(personaId, updated);
    } else if (updated.scopeId === get(activeRoomId)) {
        multiRoomPersonas.set(personaId, updated);
    }
}

export async function deletePersona(personaId: string): Promise<void> {
    const persona = await getPersona(personaId);
    if (persona?.scopeType === 'room') {
        await PersonaService.delete(personaId);
        multiRoomPersonas.delete(personaId);
        if (get(activePersonaId) === personaId) {
            clearActivePersona();
        }
        return;
    }

    const settings = await getAppSettings();

    // Capture ref for potential rollback
    const existingRef = settings.personas.refs[personaId];

    // Remove from parent's refs
    const settingsChanges: DeepPartial<AppSettings> = {
        personas: { refs: { [personaId]: undefined } }
    };
    await updateSettings(settingsChanges);

    // Remove record from DB
    try {
        await PersonaService.delete(personaId);
    } catch (error) {
        // If DB delete fails, roll back parent's refs
        await updateSettings({
            personas: { refs: { [personaId]: existingRef } }
        });
        throw error;
    }

    // Update Store
    personas.delete(personaId);
    if (get(activePersonaId) === personaId) {
        clearActivePersona();
    }
}

export async function updatePersonaAvatar(personaId: string, file: File): Promise<void> {
    const updated = await PersonaService.updateAvatar(personaId, file);
    if (updated.scopeType === 'user') {
        personas.set(personaId, updated);
    } else if (updated.scopeId === get(activeRoomId)) {
        multiRoomPersonas.set(personaId, updated);
    }
}

export async function removePersonaAvatar(personaId: string): Promise<void> {
    const updated = await PersonaService.removeAvatar(personaId);
    if (updated.scopeType === 'user') {
        personas.set(personaId, updated);
    } else if (updated.scopeId === get(activeRoomId)) {
        multiRoomPersonas.set(personaId, updated);
    }
}

// ─── Persona-owned Asset CRUD ──────────────────────────────────────

export async function createPersonaAsset(
    personaId: string,
    asset: File | AssetFields
): Promise<void> {
    const persona = await getPersona(personaId);
    if (!persona) throw new AppError('NOT_FOUND', `Persona not found: ${personaId}`);

    const sortOrder = generateSortOrder(persona.assets.refs, persona.assets.folders);
    const updated = await PersonaService.createAsset(personaId, asset, sortOrder);

    if (updated.scopeType === 'user') {
        personas.set(personaId, updated);
    } else if (updated.scopeId === get(activeRoomId)) {
        multiRoomPersonas.set(personaId, updated);
    }
}

export async function deletePersonaAsset(personaId: string, assetId: string): Promise<void> {
    const updated = await PersonaService.deleteAsset(personaId, assetId);

    if (updated.scopeType === 'user') {
        personas.set(personaId, updated);
    } else if (updated.scopeId === get(activeRoomId)) {
        multiRoomPersonas.set(personaId, updated);
    }
}

// ─── Persona-owned Folder & Item Management ─────────────────────────

export type PersonaFolderType = 'assets';

export async function createPersonaFolder(
    personaId: string,
    folderType: PersonaFolderType,
    name: string,
    parentId?: string,
    sortOrder?: string
): Promise<FolderDef> {
    const persona = await getPersona(personaId);
    if (!persona) throw new AppError('NOT_FOUND', `Persona not found: ${personaId}`);

    const newFolder: FolderDef = {
        id: generateId(),
        name,
        sortOrder:
            sortOrder ?? generateSortOrder(persona[folderType].refs, persona[folderType].folders),
        parentId
    };

    await updatePersona(personaId, {
        [folderType]: { folders: { [newFolder.id]: newFolder } }
    });

    return newFolder;
}

export async function updatePersonaFolder(
    personaId: string,
    folderType: PersonaFolderType,
    folderId: string,
    changes: DeepPartial<{ name: string; color: string; parentId: string; sortOrder: string }>
): Promise<void> {
    const persona = await getPersona(personaId);
    if (!persona) return;

    const existing = persona[folderType].folders[folderId];
    if (!existing) return;

    const updated: FolderDef = { ...existing, ...changes, id: existing.id };

    await updatePersona(personaId, {
        [folderType]: { folders: { [folderId]: updated } }
    });
}

export async function deletePersonaFolder(
    personaId: string,
    folderType: PersonaFolderType,
    folderId: string
): Promise<void> {
    await updatePersona(personaId, {
        [folderType]: { folders: { [folderId]: undefined } }
    });
}

export async function movePersonaItem(
    personaId: string,
    folderType: PersonaFolderType,
    itemId: string,
    newFolderId?: string,
    newSortOrder?: string
): Promise<void> {
    const persona = await getPersona(personaId);
    if (!persona) return;

    const existing = persona[folderType].refs[itemId];
    if (!existing) return;

    await updatePersona(personaId, {
        [folderType]: {
            refs: {
                [itemId]: {
                    ...existing,
                    folderId: newFolderId,
                    sortOrder: newSortOrder ?? existing.sortOrder
                }
            }
        }
    });
}
