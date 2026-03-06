<script lang="ts">
	import EntityList from '$lib/components/EntityList.svelte';
	import { presets, createPreset, updatePresetSummary, deletePreset } from '$lib/stores';
</script>

<EntityList
	items={$presets}
	createPlaceholder="New Preset Name"
	onCreate={(name) => createPreset({ name, description: '' })}
	onUpdate={(id, name) => updatePresetSummary(id, { name })}
	onDelete={(id) => deletePreset(id)}
/>
