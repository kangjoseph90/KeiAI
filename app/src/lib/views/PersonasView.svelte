<script lang="ts">
    import {
        personas,
        activePersona,
        selectPersona,
        createPersona,
        updatePersona,
        deletePersona,
        updatePersonaAvatar,
        removePersonaAvatar
    } from '$lib/stores';
    import type { Persona } from '$lib/services';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import { Textarea } from '$lib/components/ui/textarea';
    import { Card, CardContent } from '$lib/components/ui/card';
    import { Badge } from '$lib/components/ui/badge';
    import { Label } from '$lib/components/ui/label';
    import AssetView from '$lib/components/AssetView.svelte';
    import { Check, Pencil, Plus, Trash2, X, User, Upload } from 'lucide-svelte';

    let newName = $state('');
    let editingId = $state<string | null>(null);
    let editName = $state('');
    let editDescription = $state('');
    let uploading = $state(false);
    let fileInputRef = $state<HTMLInputElement>();

    async function startEdit(persona: Persona) {
        editingId = persona.id;
        editName = persona.name;
        editDescription = persona.description;
    }

    function cancelEdit() {
        editingId = null;
        editName = '';
        editDescription = '';
    }

    async function handleCreate() {
        if (!newName.trim()) return;
        await createPersona({ name: newName, description: '' });
        newName = '';
    }

    async function handleSave(id: string) {
        if (!editName.trim()) return;
        await updatePersona(id, { name: editName, description: editDescription });
        editingId = null;
    }

    async function handleAvatarUpload(event: Event) {
        const target = event.target as HTMLInputElement;
        const file = target.files?.[0];
        if (!file || !editingId) return;

        uploading = true;
        try {
            await updatePersonaAvatar(editingId, file);
        } finally {
            uploading = false;
            target.value = '';
        }
    }

    async function handleRemoveAvatar() {
        if (!editingId) return;
        await removePersonaAvatar(editingId);
    }
</script>

<div class="flex flex-col gap-4">
    {#if $activePersona}
        <div class="flex items-center gap-2 text-sm text-muted-foreground">
            <User class="size-4" />
            <span>Active:</span>
            <Badge variant="secondary">{$activePersona.name}</Badge>
        </div>
    {/if}

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
                <CardContent class="p-4">
                    {#if editingId === persona.id}
                        <div class="flex flex-col gap-3">
                            <div class="flex items-start gap-4">
                                <div class="relative group shrink-0">
                                    <button
                                        type="button"
                                        class="size-16 rounded-full border-2 border-muted hover:border-primary transition-colors flex items-center justify-center overflow-hidden bg-muted"
                                        onclick={() => fileInputRef?.click()}
                                        disabled={uploading}
                                    >
                                        <AssetView
                                            id={persona.avatarAssetId}
                                            alt={editName}
                                            class="size-full"
                                            fallback="none"
                                        />
                                        {#if !persona.avatarAssetId}
                                            <User class="size-6 text-muted-foreground absolute" />
                                        {/if}
                                    </button>
                                    {#if persona.avatarAssetId}
                                        <button
                                            type="button"
                                            class="absolute -top-1 -right-1 size-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center hover:bg-destructive/80 transition-colors"
                                            onclick={handleRemoveAvatar}
                                            title="Remove avatar"
                                        >
                                            <X class="size-3" />
                                        </button>
                                    {:else}
                                        <div
                                            class="absolute inset-0 rounded-full bg-background/60 backdrop-blur-sm opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity pointer-events-none"
                                        >
                                            <Upload class="size-5 text-foreground" />
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
                                <div class="flex-1 space-y-2">
                                    <div class="space-y-1">
                                        <Label>Name</Label>
                                        <Input bind:value={editName} />
                                    </div>
                                </div>
                            </div>
                            <div class="space-y-1">
                                <Label>Description</Label>
                                <Textarea bind:value={editDescription} rows={3} />
                            </div>
                            <div class="flex gap-2">
                                <Button
                                    size="sm"
                                    class="gap-1.5"
                                    onclick={() => handleSave(persona.id)}
                                >
                                    <Check class="size-4" /> Save
                                </Button>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    class="gap-1.5"
                                    onclick={cancelEdit}
                                >
                                    <X class="size-4" /> Cancel
                                </Button>
                            </div>
                        </div>
                    {:else}
                        <div class="flex items-center justify-between gap-3">
                            <div class="flex items-center gap-3 min-w-0">
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
                                    <div class="flex items-center gap-2">
                                        <p class="font-medium">{persona.name || 'Unnamed'}</p>
                                        {#if $activePersona?.id === persona.id}
                                            <Badge variant="outline" class="text-xs">Active</Badge>
                                        {/if}
                                    </div>
                                    {#if persona.description}
                                        <p
                                            class="text-sm text-muted-foreground mt-0.5 line-clamp-2"
                                        >
                                            {persona.description}
                                        </p>
                                    {/if}
                                </div>
                            </div>
                            <div class="flex gap-1 shrink-0">
                                {#if $activePersona?.id !== persona.id}
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onclick={() => selectPersona(persona.id)}
                                    >
                                        Set Active
                                    </Button>
                                {/if}
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onclick={() => startEdit(persona)}
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
                        </div>
                    {/if}
                </CardContent>
            </Card>
        {:else}
            <p class="text-sm text-muted-foreground">No personas found.</p>
        {/each}
    </div>
</div>
