<script lang="ts">
    import {
        Pin,
        Plus,
        User,
        Settings,
        Book,
        Variable,
        ImageIcon,
        FileText,
        ChevronRight,
        X
    } from 'lucide-svelte';
    import AssetView from '$lib/components/AssetView.svelte';
    import { Button } from '$lib/components/ui/button';
    import { Badge } from '$lib/components/ui/badge';
    import { Input } from '$lib/components/ui/input';
    import { Label } from '$lib/components/ui/label';
    import { ScrollArea } from '$lib/components/ui/scroll-area';
    import { Separator } from '$lib/components/ui/separator';
    import { Textarea } from '$lib/components/ui/textarea';
    import EntityList from '$lib/components/entitylist/EntityList.svelte';
    import {
        activeChat,
        addChatPersona,
        chatPersonas,
        chatLorebooks,
        chatSelections,
        createChatFolder,
        createChatLorebook,
        deleteChatLorebook,
        deleteChatFolder,
        isMultiRoom,
        multiRoomPersonas,
        personas,
        removeChatPersona,
        setChatDefaultPersona,
        setChatSelectedPersona,
        moveChatItem,
        updateChatContent,
        updateChatFolder,
        updateChatLorebook
    } from '$lib/stores';
    import { navigate } from '$lib/router';
    import { getChatVariables } from '$lib/managers';
    import type { ChatContent } from '$lib/services';
    import type { DeepPartial } from '$lib/utils/defaults';
    import LorebookItem from '$lib/views/modules/LorebookItem.svelte';

    interface Props {
        chatId: string;
    }

    let { chatId }: Props = $props();

    let newChatLorebookName = $state('');
    let personaToAdd = $state('');
    let variables = $state<[string, string][]>([]);

    const attachablePersonas = $derived(() => {
        const attached = new Set($chatPersonas.map((persona) => persona.id));
        const source = $isMultiRoom ? $multiRoomPersonas : $personas;
        return source.filter((persona) => !attached.has(persona.id));
    });

    async function updateChat(changes: DeepPartial<ChatContent>) {
        if (!$activeChat) return;
        await updateChatContent(chatId, changes);
    }

    $effect(() => {
        if (chatId) {
            getChatVariables(chatId).then((v) => {
                variables = Object.entries(v);
            });
        } else {
            variables = [];
        }
    });

    async function handleChatLorebookAdd() {
        if (!newChatLorebookName.trim()) return;
        await createChatLorebook(chatId, {
            name: newChatLorebookName,
            key: '',
            secondKey: '',
            content: '',
            depth: 0,
            disabled: false
        });
        newChatLorebookName = '';
    }

    function openPersonaSettings(personaId: string) {
        navigate({ view: 'personaStudio', personaId });
    }

    async function handlePersonaSelect(personaId: string) {
        if (!$activeChat) return;
        await setChatSelectedPersona(chatId, personaId);
    }

    async function handleSetDefaultPersona(personaId: string) {
        if (!$activeChat) return;
        await setChatDefaultPersona(chatId, personaId);
    }

    async function handlePersonaAdd() {
        if (!$activeChat || !personaToAdd) return;
        await addChatPersona(chatId, personaToAdd);
        personaToAdd = '';
    }

    async function handlePersonaRemove(personaId: string) {
        if (!$activeChat) return;
        await removeChatPersona(chatId, personaId);
    }

    function initial(name: string): string {
        return (name.trim().charAt(0) || '?').toUpperCase();
    }
</script>

<div class="flex h-full flex-col bg-muted/10 border-l">
    <!-- Panel Header -->
    <div class="flex shrink-0 items-center justify-between border-b px-4 py-3 bg-background">
        <h2 class="text-sm font-semibold flex items-center gap-2">
            <Settings class="size-4 text-muted-foreground" />
            Chat Settings
        </h2>
    </div>

    <ScrollArea class="flex-1">
        <div class="p-4 space-y-6 pb-20">
            <!-- Persona Summary -->
            {#if $activeChat}
                <section class="space-y-3">
                    <Label
                        class="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"
                    >
                        <User class="size-3" /> Personas
                    </Label>
                    <div class="mb-2 flex gap-1.5">
                        <select
                            class="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs"
                            bind:value={personaToAdd}
                        >
                            <option value="">Add persona...</option>
                            {#each attachablePersonas() as persona (persona.id)}
                                <option value={persona.id}>{persona.name}</option>
                            {/each}
                        </select>
                        <Button
                            variant="secondary"
                            size="icon"
                            class="size-8 shrink-0"
                            onclick={handlePersonaAdd}
                            disabled={!personaToAdd}
                        >
                            <Plus class="size-4" />
                        </Button>
                    </div>
                    <EntityList
                        entities={$chatPersonas}
                        config={$activeChat.personas}
                        layout="grid"
                        onCreateFolder={(name, parentId) =>
                            createChatFolder(chatId, 'personas', name, parentId)}
                        onUpdateFolder={(id, changes) =>
                            updateChatFolder(chatId, 'personas', id, changes)}
                        onDeleteFolder={(id) => deleteChatFolder(chatId, 'personas', id)}
                        onMoveItem={(itemId, newFolderId, newSortOrder) =>
                            moveChatItem(chatId, 'personas', itemId, newFolderId, newSortOrder)}
                    >
                        {#snippet empty()}
                            <div class="rounded-md border border-dashed p-3 text-center">
                                <p class="text-[10px] text-muted-foreground">
                                    No personas attached to this chat.
                                </p>
                            </div>
                        {/snippet}
                        {#snippet item({ entity: persona })}
                            {@const ref = $activeChat.personas.refs[persona.id]}
                            {@const disabled = ref?.enabled === false}
                            {@const selected = $chatSelections?.personaId === persona.id}
                            {@const isDefault = $activeChat.defaultPersonaId === persona.id}
                            <div class="group relative">
                                <button
                                    class="flex w-full min-w-0 flex-col items-center gap-1 rounded-md border bg-background p-2 text-center transition-colors {selected
                                        ? 'border-primary ring-2 ring-primary/20'
                                        : 'hover:bg-sidebar-accent'} {disabled ? 'opacity-40' : ''}"
                                    title={persona.name}
                                    {disabled}
                                    onclick={() => handlePersonaSelect(persona.id)}
                                >
                                    <div
                                        class="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-xs font-semibold"
                                    >
                                        {#if persona.avatarAssetId}
                                            <AssetView
                                                id={persona.avatarAssetId}
                                                alt={persona.name}
                                                class="size-full object-cover"
                                            />
                                        {:else}
                                            {initial(persona.name)}
                                        {/if}
                                    </div>
                                    <span class="w-full truncate text-[11px]">{persona.name}</span>
                                </button>
                                <button
                                    class="absolute -left-1 -top-1 flex size-5 items-center justify-center rounded-full bg-background text-muted-foreground opacity-0 shadow-sm ring-1 ring-border transition-opacity hover:text-foreground group-hover:opacity-100"
                                    title="Open persona settings"
                                    onclick={() => openPersonaSettings(persona.id)}
                                >
                                    <Settings class="size-3" />
                                </button>
                                <button
                                    class="absolute left-5 -top-1 flex size-5 items-center justify-center rounded-full bg-background shadow-sm ring-1 ring-border transition-opacity {isDefault
                                        ? 'text-primary opacity-100'
                                        : 'text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100'}"
                                    title="Set default persona"
                                    {disabled}
                                    onclick={() => handleSetDefaultPersona(persona.id)}
                                >
                                    <Pin class="size-3" />
                                </button>
                                <button
                                    class="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground opacity-0 transition-opacity group-hover:opacity-100"
                                    title="Remove from chat"
                                    onclick={() => handlePersonaRemove(persona.id)}
                                >
                                    <X class="size-3" />
                                </button>
                            </div>
                        {/snippet}
                    </EntityList>
                </section>
                <Separator />
            {/if}

            {#if !$activeChat}
                <div class="text-center py-8 text-xs text-muted-foreground">
                    Select a chat to view settings.
                </div>
            {:else}
                <!-- Chat Note -->
                <section class="space-y-2">
                    <Label
                        class="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"
                    >
                        <FileText class="size-3" /> Chat Note
                    </Label>
                    <Textarea
                        rows={4}
                        class="text-xs bg-background"
                        placeholder="Context specific to this conversation..."
                        value={$activeChat.chatNote}
                        oninput={(e) => updateChat({ chatNote: e.currentTarget.value })}
                    />
                    <p class="text-[10px] text-muted-foreground leading-tight">
                        This is added to the AI's memory only for this specific chat.
                    </p>
                </section>

                <!-- Active Lorebooks -->
                <section class="space-y-3">
                    <div class="flex items-center justify-between">
                        <Label
                            class="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"
                        >
                            <Book class="size-3" /> Chat Lorebooks
                        </Label>
                        <Badge variant="outline" class="text-[10px] font-mono"
                            >{$chatLorebooks.length}</Badge
                        >
                    </div>

                    <div class="flex gap-1.5">
                        <Input
                            placeholder="New lorebook..."
                            class="h-8 text-xs bg-background"
                            bind:value={newChatLorebookName}
                            onkeydown={(e) => e.key === 'Enter' && handleChatLorebookAdd()}
                        />
                        <Button
                            variant="secondary"
                            size="icon"
                            class="size-8 shrink-0"
                            onclick={handleChatLorebookAdd}
                        >
                            <Plus class="size-4" />
                        </Button>
                    </div>

                    <EntityList
                        entities={$chatLorebooks}
                        config={$activeChat.lorebooks}
                        layout="list"
                        onCreateFolder={(name, parentId) =>
                            createChatFolder(chatId, 'lorebooks', name, parentId)}
                        onUpdateFolder={(id, changes) =>
                            updateChatFolder(chatId, 'lorebooks', id, changes)}
                        onDeleteFolder={(id) => deleteChatFolder(chatId, 'lorebooks', id)}
                        onMoveItem={(itemId, newFolderId, newSortOrder) =>
                            moveChatItem(chatId, 'lorebooks', itemId, newFolderId, newSortOrder)}
                    >
                        {#snippet empty()}
                            <p class="py-2 text-center text-[10px] italic text-muted-foreground">
                                No chat lorebooks.
                            </p>
                        {/snippet}
                        {#snippet item({ entity: lb })}
                            <LorebookItem
                                item={lb}
                                onUpdate={(id, changes) => updateChatLorebook(chatId, id, changes)}
                                onDelete={(id) => deleteChatLorebook(chatId, id)}
                            />
                        {/snippet}
                    </EntityList>
                </section>

                <!-- Runtime Variables -->
                <section class="space-y-3">
                    <Label
                        class="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"
                    >
                        <Variable class="size-3" /> Chat Variables
                    </Label>

                    <div class="bg-background border rounded-md divide-y overflow-hidden">
                        {#each variables as [key, val] (key)}
                            <div
                                class="px-3 py-2 flex items-center justify-between gap-2 text-[11px]"
                            >
                                <code class="bg-muted px-1 rounded text-primary font-mono"
                                    >{key}</code
                                >
                                <span class="text-muted-foreground truncate max-w-[120px]"
                                    >{val || '(empty)'}</span
                                >
                            </div>
                        {:else}
                            <p class="p-3 text-[10px] text-muted-foreground italic text-center">
                                No active variables.
                            </p>
                        {/each}
                    </div>
                </section>

                <!-- Runtime Assets -->
                <section class="space-y-3">
                    <Label
                        class="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"
                    >
                        <ImageIcon class="size-3" /> Gallery
                    </Label>
                    <div class="grid grid-cols-3 gap-2">
                        <button
                            class="aspect-square rounded border border-dashed border-muted-foreground/30 flex items-center justify-center text-muted-foreground/50 hover:bg-muted hover:text-primary transition-colors"
                        >
                            <Plus class="size-4" />
                        </button>
                    </div>
                </section>
            {/if}
        </div>
    </ScrollArea>

    <!-- Footer Action -->
    <div class="p-4 border-t bg-background shrink-0">
        <Button
            variant="ghost"
            size="sm"
            class="w-full justify-between text-xs font-normal text-muted-foreground group"
            onclick={() => navigate({ view: 'settings' })}
        >
            Open Settings
            <ChevronRight class="size-3 transition-transform group-hover:translate-x-0.5" />
        </Button>
    </div>
</div>
