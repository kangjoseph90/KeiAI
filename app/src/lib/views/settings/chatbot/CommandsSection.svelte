<script lang="ts">
    import { Plus } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import EntityList from '$lib/components/entitylist/EntityList.svelte';
    import EmptyListPlaceholder from '$lib/components/EmptyListPlaceholder.svelte';
    import ListActionBar from '$lib/components/ListActionBar.svelte';
    import {
        defaultChatCommandFields,
        type ChatCommand,
        type ChatCommandPanel
    } from '$lib/types/command';
    import { generateSortOrder, listItems } from '$lib/utils/ordering';
    import { generateId } from '$lib/utils/id';
    import { toast } from '$lib/ui';
    import { AppError, getErrorMessage } from '$lib/types/errors';
    import { deepMerge, type DeepPartial } from '$lib/utils/defaults';
    import {
        chatCommandNameKey,
        createUnusedChatCommandName,
        normalizeChatCommandName
    } from '$lib/managers/command';
    import type { FolderDef } from '$lib/types/refs';
    import CommandItem from './CommandItem.svelte';

    let {
        panel,
        onSave,
        onDelete,
        onCreateFolder,
        onUpdateFolder,
        onDeleteFolder,
        onMoveItem
    }: {
        panel: ChatCommandPanel;
        onSave: (command: ChatCommand) => void | Promise<void>;
        onDelete: (commandId: string) => void | Promise<void>;
        onCreateFolder: (name: string, parentId?: string, sortOrder?: string) => Promise<FolderDef>;
        onUpdateFolder: (folderId: string, changes: Partial<FolderDef>) => Promise<void>;
        onDeleteFolder: (folderId: string) => Promise<void>;
        onMoveItem: (itemId: string, folderId?: string, sortOrder?: string) => Promise<void>;
    } = $props();

    let creating = $state(false);
    let editingId = $state<string | null>(null);
    const commands = $derived(listItems(panel));

    async function add(): Promise<void> {
        if (creating) return;
        creating = true;
        try {
            const command: ChatCommand = {
                ...defaultChatCommandFields,
                name: createUnusedChatCommandName(commands),
                id: generateId(),
                sortOrder: generateSortOrder(panel.refs, panel.folders)
            };
            await onSave(command);
            editingId = command.id;
        } catch (error) {
            toast.error({ title: 'Could not add command', description: getErrorMessage(error) });
        } finally {
            creating = false;
        }
    }

    async function update(commandId: string, changes: DeepPartial<ChatCommand>): Promise<void> {
        const existing = panel.refs[commandId];
        if (!existing) throw new AppError('NOT_FOUND', `Chat command not found: ${commandId}`);
        const name =
            changes.name === undefined ? existing.name : normalizeChatCommandName(changes.name);
        if (
            commands.some(
                (command) =>
                    command.id !== commandId &&
                    chatCommandNameKey(command.name) === chatCommandNameKey(name)
            )
        ) {
            throw new AppError('INVALID_INPUT', `Chat command already exists: /${name}`);
        }
        await onSave({ ...deepMerge(existing, changes), name, id: existing.id });
    }
</script>

<section class="flex flex-col gap-4 px-2">
    <ListActionBar description="Run custom workflows from the chat composer with slash commands.">
        <Button size="sm" class="gap-1.5" disabled={creating} aria-busy={creating} onclick={add}>
            <Plus class="size-4" /> Add command
        </Button>
    </ListActionBar>

    <EntityList
        entities={commands}
        config={panel}
        mode="manage"
        layout="list"
        {onCreateFolder}
        {onUpdateFolder}
        {onDeleteFolder}
        {onMoveItem}
    >
        {#snippet empty()}<EmptyListPlaceholder message="No custom commands defined." />{/snippet}
        {#snippet item({ entity: command }: { entity: ChatCommand })}
            <CommandItem
                item={command}
                initiallyEditing={editingId === command.id}
                onUpdate={update}
                {onDelete}
            />
        {/snippet}
    </EntityList>
</section>
