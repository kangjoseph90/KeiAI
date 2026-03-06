<script lang="ts">
	import EntityList from '$lib/components/EntityList.svelte';
	import { personas, createPersona, updatePersona, deletePersona } from '$lib/stores';
</script>

<EntityList
	items={$personas}
	createPlaceholder="New Persona Name"
	onCreate={(name) => createPersona({ name, description: '' })}
	onUpdate={(id, name) => updatePersona(id, { name })}
	onDelete={(id) => deletePersona(id)}
/>
