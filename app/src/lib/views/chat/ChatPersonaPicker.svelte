<script lang="ts">
    import ResourcePickerDialog from '$lib/components/ResourcePickerDialog.svelte';
    import {
        activeChat,
        addChatPersona,
        appSettings,
        chatPersonas,
        isMultiRoom,
        multiRoomPersonas,
        personas,
        t
    } from '$lib/stores';
    import { addChatPersonaFromLibrary } from '$lib/managers';
    import { personaPickerOpen, toast } from '$lib/ui';
    import { getErrorMessage } from '$lib/types/errors';

    let { chatId }: { chatId: string } = $props();

    const pickerPersonas = $derived($isMultiRoom ? $multiRoomPersonas : $personas);
    const pickerConfig = $derived(
        $isMultiRoom
            ? { refs: {}, folders: {} }
            : ($appSettings?.personas ?? { refs: {}, folders: {} })
    );

    async function addPersonas(personaIds: string[]): Promise<boolean> {
        if ($activeChat?.id !== chatId) return false;
        try {
            for (const personaId of personaIds) await addChatPersona(chatId, personaId);
            return true;
        } catch (error) {
            toast.error({
                title: $t('chat.toast.addPersonas'),
                description: getErrorMessage(error)
            });
            return false;
        }
    }

    async function copyPersonas(personaIds: string[]): Promise<boolean> {
        if ($activeChat?.id !== chatId) return false;
        try {
            for (const personaId of personaIds) {
                await addChatPersonaFromLibrary(chatId, personaId);
            }
            return true;
        } catch (error) {
            toast.error({
                title: $t('chat.toast.copyPersonas'),
                description: getErrorMessage(error)
            });
            return false;
        }
    }
</script>

<ResourcePickerDialog
    bind:open={$personaPickerOpen}
    title={$t('chat.personaPicker.title')}
    description={$t('chat.personaPicker.description')}
    singularLabel={$t('chat.personaPicker.singular')}
    resourceLabel={$t('chat.personaPicker.plural')}
    resources={pickerPersonas}
    config={pickerConfig}
    attachedIds={$chatPersonas.map((persona) => persona.id)}
    ownerTable="personas"
    onAdd={addPersonas}
    roomTabLabel={$t('chat.personaPicker.roomTab')}
    libraryResources={$isMultiRoom ? $personas : undefined}
    libraryConfig={$isMultiRoom ? $appSettings?.personas : undefined}
    onCopy={$isMultiRoom ? copyPersonas : undefined}
/>
