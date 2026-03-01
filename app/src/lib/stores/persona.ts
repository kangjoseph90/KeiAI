import { get } from 'svelte/store';
import { PersonaService, type PersonaFields } from '../services/persona.js';
import { SettingsService } from '../services';
import { generateSortOrder, sortByRefs } from '../utils/ordering.js';
import { personas, appSettings } from './state.js';

export async function loadPersonas() {
	const settings = get(appSettings);
	const list = await PersonaService.list();
	if (settings?.personaRefs) {
		personas.set(sortByRefs(list, settings.personaRefs));
	} else {
		personas.set(list);
	}
}

export async function createPersona(fields: PersonaFields) {
	const settings = get(appSettings);
	if (!settings) return;

	const persona = await PersonaService.create(fields);
	personas.update((list) => [...list, persona]);
	const existing = settings.personaRefs || [];
	const personaRefs = [...existing, { id: persona.id, sortOrder: generateSortOrder(existing) }];
	const updatedSettings = await SettingsService.update({ personaRefs });
	if (updatedSettings) appSettings.set(updatedSettings);

	return persona;
}

export async function updatePersona(id: string, changes: Partial<PersonaFields>) {
	const updated = await PersonaService.update(id, changes);
	if (updated) {
		personas.update((list) => list.map((p) => (p.id === id ? updated : p)));
	}
}

export async function deletePersona(id: string) {
	const settings = get(appSettings);
	if (!settings) return;

	await PersonaService.delete(id);
	const personaRefs = (settings.personaRefs || []).filter((r) => r.id !== id);
	const updatedSettings = await SettingsService.update({ personaRefs });
	if (updatedSettings) appSettings.set(updatedSettings);

	personas.update((list) => list.filter((p) => p.id !== id));
}
