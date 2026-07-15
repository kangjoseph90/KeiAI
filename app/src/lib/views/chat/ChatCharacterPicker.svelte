<script lang="ts">
    import ResourcePickerDialog from '$lib/components/ResourcePickerDialog.svelte';
    import {
        activeChat,
        activeRoom,
        addRoomCharacter,
        appSettings,
        characters,
        isMultiRoom,
        multiRoomCharacters,
        roomCharacters
    } from '$lib/stores';
    import { addRoomCharacterFromLibrary, syncChatGreetings } from '$lib/managers';
    import { characterPickerOpen, toast } from '$lib/ui';
    import { getErrorMessage } from '$lib/types/errors';

    let { roomId }: { roomId: string } = $props();

    const pickerCharacters = $derived($isMultiRoom ? $multiRoomCharacters : $characters);
    const pickerConfig = $derived(
        $isMultiRoom
            ? { refs: {}, folders: {} }
            : ($appSettings?.characters ?? { refs: {}, folders: {} })
    );

    async function addCharacters(characterIds: string[]): Promise<boolean> {
        if ($activeRoom?.id !== roomId) return false;
        const chatId = $activeChat?.id;
        try {
            for (const characterId of characterIds) {
                await addRoomCharacter(roomId, characterId);
            }
            if (chatId) await syncChatGreetings(chatId);
            return true;
        } catch (error) {
            toast.error({
                title: 'Could not add characters',
                description: getErrorMessage(error)
            });
            return false;
        }
    }

    async function copyCharacters(characterIds: string[]): Promise<boolean> {
        if ($activeRoom?.id !== roomId) return false;
        const chatId = $activeChat?.id;
        try {
            for (const characterId of characterIds) {
                await addRoomCharacterFromLibrary(roomId, characterId);
            }
            if (chatId) await syncChatGreetings(chatId);
            return true;
        } catch (error) {
            toast.error({
                title: 'Could not copy characters',
                description: getErrorMessage(error)
            });
            return false;
        }
    }
</script>

<ResourcePickerDialog
    bind:open={$characterPickerOpen}
    title="Add characters"
    description="Choose who belongs in this room. You can add several at once."
    singularLabel="character"
    resourceLabel="characters"
    resources={pickerCharacters}
    config={pickerConfig}
    attachedIds={$roomCharacters.map((character) => character.id)}
    ownerTable="characters"
    onAdd={addCharacters}
    roomTabLabel="Room characters"
    libraryResources={$isMultiRoom ? $characters : undefined}
    libraryConfig={$isMultiRoom ? $appSettings?.characters : undefined}
    onCopy={$isMultiRoom ? copyCharacters : undefined}
/>
