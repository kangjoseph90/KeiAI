import { get } from 'svelte/store';
import { PersonaService, type PersonaFields, type Persona } from '../services/persona.js';
import { SettingsService } from '../services';
import { generateSortOrder, sortByRefs } from '../utils/ordering.js';
import { personas, appSettings } from './state.js';
import { AppError } from '../errors.js';

/**
 * Service errors propagate to the caller — this function does not catch them.
 * Callers (e.g. route load functions) are responsible for error boundaries.
 */
export async function loadPersonas(): Promise<void> {
	const settings = get(appSettings);
	const list = await PersonaService.list();
	if (settings?.personaRefs) {
		personas.set(sortByRefs(list, settings.personaRefs));
	} else {
		personas.set(list);
	}
}

export async function createPersona(fields: Partial<PersonaFields>): Promise<Persona> {
	const settings = get(appSettings) || await SettingsService.get();

	if (!settings) {
		throw new AppError('NOT_FOUND', 'Settings not found');
	}

	// Create Record in DB
	const persona = await PersonaService.create(fields);

	// Add to parent's refs
	const existingRefs = settings.personaRefs || [];
	const personaRefs = [...existingRefs, { id: persona.id, sortOrder: generateSortOrder(existingRefs) }];
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

export async function updatePersona(id: string, changes: Partial<PersonaFields>): Promise<void> {
	const updated = await PersonaService.update(id, changes);
	personas.update((list) => list.map((p) => (p.id === id ? updated : p)));
}

export async function deletePersona(id: string): Promise<void> {
	const settings = get(appSettings) || await SettingsService.get();

	if (!settings) {
		throw new AppError('NOT_FOUND', 'Settings not found');
	}

	// Remove from parent's refs
	const existingRefs = settings.personaRefs || [];
	const personaRefs = existingRefs.filter((r) => r.id !== id);
	await SettingsService.update({ personaRefs });

	// Remove record from DB
	try {
		await PersonaService.delete(id);
	} catch (error) {
		// If DB delete fails, roll back parent's refs
		await SettingsService.update({ personaRefs: existingRefs });
		throw error;
	}

	// Update Store
	appSettings.update((s) => (s ? { ...s, personaRefs } : s));
	personas.update((list) => list.filter((p) => p.id !== id));
}
