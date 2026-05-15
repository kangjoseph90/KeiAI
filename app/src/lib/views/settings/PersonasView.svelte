<script lang="ts">
    import {
        personas,
        createPersona,
        updatePersona,
        deletePersona,
        updatePersonaAvatar,
        removePersonaAvatar,
        activePersona,
        activeChat,
        activeRoom
    } from '$lib/stores';
    import { navigate } from '$lib/router';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import { Textarea } from '$lib/components/ui/textarea';
    import { Card, CardContent } from '$lib/components/ui/card';
    import { Label } from '$lib/components/ui/label';
    import AssetView from '$lib/components/AssetView.svelte';
    import { ArrowLeft, Check, Pencil, Plus, Trash2, X, User, Upload } from 'lucide-svelte';

    let { personaId }: { personaId?: string } = $props();

    let newName = $state('');
    let editName = $state('');
    let editDescription = $state('');
    let uploading = $state(false);
    let fileInputRef = $state<HTMLInputElement>();
    let loadedPersonaId = $state<string | null>(null);

    const selectedPersona = $derived(
        personaId
            ? $activePersona?.id === personaId
                ? $activePersona
                : ($personas.find((persona) => persona.id === personaId) ?? null)
            : null
    );

    $effect(() => {
        const persona = selectedPersona;
        if (!persona || loadedPersonaId === persona.id) return;
        loadedPersonaId = persona.id;
        editName = persona.name;
        editDescription = persona.description;
    });

    async function handleCreate() {
        const name = newName.trim();
        if (!name) return;
        const persona = await createPersona({ name, description: '' });
        newName = '';
        navigate({ view: 'personaStudio', personaId: persona.id });
    }

    async function handleSave(id: string) {
        if (!editName.trim()) return;
        await updatePersona(id, { name: editName, description: editDescription });
        backToContext();
    }

    async function handleDelete(id: string) {
        await deletePersona(id);
        backToContext();
    }

    function backToContext() {
        if ($activeRoom && $activeChat) {
            navigate({ view: 'room', roomId: $activeRoom.id, chatId: $activeChat.id });
        } else if ($activeRoom) {
            navigate({ view: 'room', roomId: $activeRoom.id });
        } else {
            navigate({ view: 'home' });
        }
    }

    async function handleAvatarUpload(event: Event) {
        const target = event.target as HTMLInputElement;
        const file = target.files?.[0];
        if (!file || !selectedPersona) return;

        uploading = true;
        try {
            await updatePersonaAvatar(selectedPersona.id, file);
        } finally {
            uploading = false;
            target.value = '';
        }
    }

    async function handleRemoveAvatar() {
        if (!selectedPersona) return;
        await removePersonaAvatar(selectedPersona.id);
    }
</script>

{#if selectedPersona}
    <div class="flex min-h-[70vh] flex-col gap-5">
        <div class="flex items-center justify-between gap-3">
            <div class="flex min-w-0 items-center gap-3">
                <Button variant="ghost" size="icon" onclick={backToContext}>
                    <ArrowLeft class="size-4" />
                </Button>
                <div class="min-w-0">
                    <h2 class="truncate text-xl font-semibold">{selectedPersona.name}</h2>
                    <p class="text-xs text-muted-foreground">Persona editor</p>
                </div>
            </div>
            <div class="flex gap-2">
                <Button
                    variant="destructive"
                    class="gap-1.5"
                    onclick={() => handleDelete(selectedPersona.id)}
                >
                    <Trash2 class="size-4" /> Delete
                </Button>
                <Button class="gap-1.5" onclick={() => handleSave(selectedPersona.id)}>
                    <Check class="size-4" /> Save
                </Button>
            </div>
        </div>

        <div class="grid gap-6 lg:grid-cols-[180px_minmax(0,1fr)]">
            <div class="space-y-3">
                <div class="relative group size-32">
                    <button
                        type="button"
                        class="flex size-32 items-center justify-center overflow-hidden rounded-md border bg-muted"
                        onclick={() => fileInputRef?.click()}
                        disabled={uploading}
                    >
                        <AssetView
                            id={selectedPersona.avatarAssetId}
                            alt={editName}
                            class="size-full object-cover"
                            fallback="none"
                        />
                        {#if !selectedPersona.avatarAssetId}
                            <User class="absolute size-10 text-muted-foreground" />
                        {/if}
                    </button>
                    {#if selectedPersona.avatarAssetId}
                        <button
                            type="button"
                            class="absolute -right-2 -top-2 flex size-7 items-center justify-center rounded-full bg-destructive text-destructive-foreground"
                            onclick={handleRemoveAvatar}
                            title="Remove avatar"
                        >
                            <X class="size-4" />
                        </button>
                    {:else}
                        <div
                            class="pointer-events-none absolute inset-0 flex items-center justify-center rounded-md bg-background/60 opacity-0 transition-opacity group-hover:opacity-100"
                        >
                            <Upload class="size-6" />
                        </div>
                    {/if}
                    <input
                        bind:this={fileInputRef}
                        type="file"
                        accept="image/png, image/jpeg, image/webp"
                        class="hidden"
                        onchange={handleAvatarUpload}
                    />
                </div>
            </div>

            <div class="space-y-4">
                <div class="space-y-1">
                    <Label>Name</Label>
                    <Input bind:value={editName} />
                </div>
                <div class="space-y-1">
                    <Label>Description</Label>
                    <Textarea bind:value={editDescription} rows={12} />
                </div>
            </div>
        </div>
    </div>
{:else if personaId}
    <div class="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
        <p class="text-sm text-muted-foreground">Persona not found.</p>
        <Button variant="outline" onclick={backToContext}>Back</Button>
    </div>
{:else}
    <div class="flex flex-col gap-4">
        <div class="flex gap-2">
            <Input
                bind:value={newName}
                placeholder="New persona name"
                class="flex-1"
                onkeydown={(e) => e.key === 'Enter' && handleCreate()}
            />
            <Button class="gap-1.5" onclick={handleCreate}>
                <Plus class="size-4" /> Create
            </Button>
        </div>

        <div class="flex flex-col gap-2">
            {#each $personas as persona (persona.id)}
                <Card>
                    <CardContent class="flex items-center justify-between gap-3 p-4">
                        <button
                            class="flex min-w-0 flex-1 items-center gap-3 text-left"
                            onclick={() =>
                                navigate({ view: 'personaStudio', personaId: persona.id })}
                        >
                            <AssetView
                                id={persona.avatarAssetId}
                                class="size-8 rounded-full border bg-muted"
                                fallback="none"
                            >
                                {#if !persona.avatarAssetId}
                                    <User class="size-4 text-muted-foreground" />
                                {/if}
                            </AssetView>
                            <div class="min-w-0">
                                <p class="font-medium">{persona.name || 'Unnamed'}</p>
                                {#if persona.description}
                                    <p class="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
                                        {persona.description}
                                    </p>
                                {/if}
                            </div>
                        </button>
                        <div class="flex shrink-0 gap-1">
                            <Button
                                size="sm"
                                variant="outline"
                                onclick={() =>
                                    navigate({ view: 'personaStudio', personaId: persona.id })}
                            >
                                <Pencil class="size-4" />
                            </Button>
                            <Button
                                size="sm"
                                variant="destructive"
                                onclick={() => deletePersona(persona.id)}
                            >
                                <Trash2 class="size-4" />
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            {:else}
                <p class="text-sm text-muted-foreground">No personas found.</p>
            {/each}
        </div>
    </div>
{/if}
