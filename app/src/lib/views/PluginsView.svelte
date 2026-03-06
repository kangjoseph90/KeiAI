<script lang="ts">
	import EntityList from '$lib/components/EntityList.svelte';
	import { plugins, createPlugin, updatePlugin, deletePlugin } from '$lib/stores';
</script>

<EntityList
	items={$plugins}
	createPlaceholder="New Plugin Name"
	onCreate={(name) =>
		createPlugin({ name, description: '', version: '0.0.1', code: '', config: {}, hooks: [] })}
	onUpdate={(id, name) => updatePlugin(id, { name })}
	onDelete={(id) => deletePlugin(id)}
/>
