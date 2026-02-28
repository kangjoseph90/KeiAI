import { get } from 'svelte/store';
import { PersonaService, type Persona, type PersonaFields } from '../services/persona.js';
import { updateSettings } from './settings.js';
import { generateSortOrder } from './ordering.js';
import { personas, appSettings } from './state.js';

export async function loadPersonas() {
	personas.set(await PersonaService.list());
}

export async function createPersona(fields: PersonaFields) {
	const persona = await PersonaService.create(fields);
	personas.update((list) => [...list, persona]);

	const settings = get(appSettings);
	if (settings) {
		const existing = settings.personaRefs || [];
		await updateSettings({
			personaRefs: [...existing, { id: persona.id, sortOrder: generateSortOrder(existing) }]
		});
	}

	return persona;
}

export async function updatePersona(id: string, changes: Partial<PersonaFields>) {
	const updated = await PersonaService.update(id, changes);
	if (updated) {
		personas.update((list) => list.map((p) => (p.id === id ? updated : p)));
	}
}

export async function deletePersona(id: string) {
	await PersonaService.delete(id);

	const settings = get(appSettings);
	if (settings) {
		await updateSettings({
			personaRefs: (settings.personaRefs || []).filter((r) => r.id !== id)
		});
	}

	personas.update((list) => list.filter((p) => p.id !== id));
}
