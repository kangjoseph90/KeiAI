import { get } from 'svelte/store';
import { PersonaService, type PersonaFields, type Persona } from '$lib/services/content/persona';
import { SettingsService } from '$lib/services';
import { generateSortOrder, sortByRefs } from '$lib/utils/ordering';
import type { DeepPartial } from '$lib/utils/defaults';
import { appSettings, activePersona, personas } from '../state';
import { getAppSettings, updateSettings } from './settings';
import { AppError } from '$lib/types/errors';

/**
 * Returns persona from store cache first, then from DB if needed.
 * Explicitly throws error if not found
 */
export async function getPersona(personaId: string): Promise<Persona> {
    const cached = personas.get(personaId);
    if (cached) return cached;
    const db = await PersonaService.get(personaId);
    if (!db) throw new AppError('NOT_FOUND', `Persona not found: ${personaId}`);
    return db;
}

/**
 * Service errors propagate to the caller — this function does not catch them.
 * Callers (e.g. route load functions) are responsible for error boundaries.
 */
export async function loadPersonas(): Promise<void> {
    const settings = await getAppSettings();
    const list = await PersonaService.list();
    if (settings?.personaRefs) {
        personas.setAll(sortByRefs(list, settings.personaRefs));
    } else {
        personas.setAll(list);
    }
}

export async function selectPersona(personaId: string): Promise<void> {
    await getPersona(personaId);
    await updateSettings({ personaId: personaId });
}

export async function createPersona(fields: DeepPartial<PersonaFields> = {}): Promise<Persona> {
    const settings = await getAppSettings();

    // Create Record in DB
    const persona = await PersonaService.create(fields);

    // Add to parent's refs
    const existingRefs = settings.personaRefs || [];
    const personaRefs = [
        ...existingRefs,
        { id: persona.id, sortOrder: generateSortOrder(existingRefs) }
    ];
    try {
        await updateSettings({ personaRefs });
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
    const currentList = get(personas);
    if (personas.size <= 1) {
        throw new AppError('DELETE_LAST_ITEM', 'Cannot delete the last persona.');
    }

    const settings = await getAppSettings();

    // Remove from parent's refs
    const existingRefs = settings.personaRefs || [];
    const personaRefs = existingRefs.filter((r) => r.id !== personaId);

    // If deleting the selected persona, determine a fallback
    const isDeletingSelected = settings.personaId === personaId;
    const fallback = isDeletingSelected ? currentList.find((p) => p.id !== personaId) : undefined;

    const settingsChanges = fallback ? { personaRefs, personaId: fallback.id } : { personaRefs };

    await updateSettings(settingsChanges);

    // Remove record from DB
    try {
        await PersonaService.delete(personaId);
    } catch (error) {
        // If DB delete fails, roll back parent's refs
        await updateSettings({ personaRefs: existingRefs });
        throw error;
    }

    // Update Store
    personas.delete(personaId);
}
