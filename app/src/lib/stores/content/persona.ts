import { get } from 'svelte/store';
import { PersonaService, type PersonaFields, type Persona } from '$lib/services/content/persona';
import { SettingsService } from '$lib/services';
import { generateSortOrder, sortByRefs } from '$lib/utils/ordering';
import type { DeepPartial } from '$lib/utils/defaults';
import { personas, appSettings, activePersona } from '../state';
import { getAppSettings } from './settings';
import { AppError } from '$lib/types/errors';

/**
 * Returns persona from store cache first, then from DB if needed.
 * Explicitly throws error if not found
 */
export async function getPersona(personaId: string): Promise<Persona> {
	const active = get(personas).find((p) => p.id === personaId);
	if (active) return active;
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
		personas.set(sortByRefs(list, settings.personaRefs));
	} else {
		personas.set(list);
	}
}

export async function selectPersona(personaId: string): Promise<void> {
	const persona = await getPersona(personaId);
	activePersona.set(persona);
	appSettings.update((s) => (s ? { ...s, personaId: personaId } : s));
	await SettingsService.update({ personaId: personaId });
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
		await SettingsService.update({ personaRefs });
	} catch (error) {
		// If parent's refs update fails, roll back DB
		await PersonaService.delete(persona.id);
		throw error;
	}

	// Update Store
	appSettings.update((s) => (s ? { ...s, personaRefs } : s));
	personas.update((list) => [...list, persona]);

	return persona;
}

export async function updatePersona(
	personaId: string,
	changes: DeepPartial<PersonaFields>
): Promise<void> {
	const updated = await PersonaService.update(personaId, changes);
	personas.update((list) => list.map((p) => (p.id === personaId ? updated : p)));
}

export async function deletePersona(personaId: string): Promise<void> {
	const currentList = get(personas);
	if (currentList.length <= 1) {
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

	await SettingsService.update(settingsChanges);

	// Remove record from DB
	try {
		await PersonaService.delete(personaId);
	} catch (error) {
		// If DB delete fails, roll back parent's refs
		await SettingsService.update({ personaRefs: existingRefs });
		throw error;
	}

	// Update Store
	appSettings.update((s) => (s ? { ...s, ...settingsChanges } : s));
	personas.update((list) => list.filter((p) => p.id !== personaId));
}
