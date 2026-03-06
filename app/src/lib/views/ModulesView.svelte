<script lang="ts">
	import EntityList from '$lib/components/EntityList.svelte';
	import { modules, createModule, updateModule, deleteModule } from '$lib/stores';
</script>

<EntityList
	items={$modules}
	createPlaceholder="New Module Name"
	onCreate={(name) => createModule({ name, description: '' })}
	onUpdate={(id, name) => updateModule(id, { name })}
	onDelete={(id) => deleteModule(id)}
/>
