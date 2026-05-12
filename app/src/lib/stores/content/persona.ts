import { PersonaService, type PersonaFields, type Persona } from '$lib/services/content/persona';
import { generateSortOrder, sortByRefs } from '$lib/utils/ordering';
import type { DeepPartial } from '$lib/utils/defaults';
import { personas } from '../state';
import { getAppSettings, updateSettings } from './settings';
import { AssetService } from '$lib/services/asset';
import { AppError } from '$lib/types/errors';

/**
 * Returns persona from store cache first, then from DB if needed.
 * Returns null if not found.
 */
export async function getPersona(personaId: string): Promise<Persona | null> {
    const cached = personas.get(personaId);
    if (cached) return cached;
    return PersonaService.get(personaId);
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

export async function createPersona(fields: DeepPartial<PersonaFields> = {}): Promise<Persona> {
    const settings = await getAppSettings();

    // Create Record in DB
    const persona = await PersonaService.create(fields);

    // Add to parent's refs
    const sortOrder = generateSortOrder(settings.personas.refs);
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

export async function updatePersona(
    personaId: string,
    changes: DeepPartial<PersonaFields>
): Promise<void> {
    const updated = await PersonaService.update(personaId, changes);
    personas.set(personaId, updated);
}

export async function deletePersona(personaId: string): Promise<void> {
    const settings = await getAppSettings();

    // Capture ref for potential rollback
    const existingRef = settings.personas.refs[personaId];

    // Remove from parent's refs
    const settingsChanges: DeepPartial<import('$lib/services').AppSettings> = {
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
}

export async function updatePersonaAvatar(personaId: string, file: File): Promise<void> {
    const persona = await getPersona(personaId);
    if (!persona) throw new AppError('NOT_FOUND', `Persona not found: ${personaId}`);
    const oldAssetId = persona.avatarAssetId;

    const newAssetId = await AssetService.write(file, 'resource');
    await updatePersona(personaId, { avatarAssetId: newAssetId });

    if (oldAssetId) {
        await AssetService.delete(oldAssetId).catch(() => {});
    }
}

export async function removePersonaAvatar(personaId: string): Promise<void> {
    const persona = await getPersona(personaId);
    if (!persona) throw new AppError('NOT_FOUND', `Persona not found: ${personaId}`);
    const oldAssetId = persona.avatarAssetId;

    if (!oldAssetId) return;

    await updatePersona(personaId, { avatarAssetId: undefined });
    await AssetService.delete(oldAssetId).catch(() => {});
}
