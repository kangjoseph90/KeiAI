<script lang="ts">
    import { ArrowLeft, Download, IdCard, Trash2, Upload, User, UserRound } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import {
        Card,
        CardContent,
        CardDescription,
        CardHeader,
        CardTitle
    } from '$lib/components/ui/card';
    import { Input } from '$lib/components/ui/input';
    import { Label } from '$lib/components/ui/label';
    import { ScrollArea } from '$lib/components/ui/scroll-area';
    import { Textarea } from '$lib/components/ui/textarea';
    import { Badge } from '$lib/components/ui/badge';
    import AssetView from '$lib/components/AssetView.svelte';
    import {
        activeChat,
        activePersona,
        activeRoom,
        deletePersona,
        removePersonaAvatar,
        updatePersona,
        updatePersonaAvatar
    } from '$lib/stores';
    import { navigate } from '$lib/router';
    import { isKeiServer } from '$lib/adapters/pb';
    import { exportPersonaFile } from '$lib/managers/persona';

    let { personaId }: { personaId: string } = $props();

    let avatarInput = $state<HTMLInputElement>();

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
        if (!$activePersona || !file) return;

        await updatePersonaAvatar($activePersona.id, file);
        target.value = '';
    }

    async function handleDelete() {
        if (!$activePersona) return;
        await deletePersona($activePersona.id);
        backToContext();
    }
</script>

<div class="flex h-full min-h-0 flex-col bg-background">
    <header class="flex shrink-0 items-center justify-between border-b px-6 py-4">
        <div class="flex items-center gap-4">
            <Button variant="ghost" size="icon" onclick={backToContext} title="Back">
                <ArrowLeft class="size-5" />
            </Button>
            <div>
                <h1 class="flex items-center gap-2 text-lg font-semibold">
                    Persona Studio
                    {#if $activePersona}
                        <span class="font-normal text-muted-foreground">/</span>
                        <span class="text-primary">{$activePersona.name}</span>
                    {/if}
                </h1>
                <p class="text-xs text-muted-foreground">Shape the voice behind user messages</p>
            </div>
        </div>

        <div class="flex items-center gap-2">
            <Badge variant="outline" class="font-mono text-[10px]">ID: {personaId}</Badge>
            <Button
                variant="outline"
                size="sm"
                class="gap-1.5"
                disabled={!$activePersona}
                onclick={() =>
                    $activePersona &&
                    exportPersonaFile($activePersona.id, { kind: 'risu', format: 'png' })}
                title="Export Risu PNG"
            >
                <Download class="size-4" />
                Risu PNG
            </Button>
            {#if isKeiServer()}
                <Button
                    variant="outline"
                    size="sm"
                    class="gap-1.5"
                    disabled={!$activePersona}
                    onclick={() =>
                        $activePersona &&
                        exportPersonaFile($activePersona.id, {
                            kind: 'keipersona',
                            assetMode: 'light'
                        })}
                    title="Export Kei Light"
                >
                    <Download class="size-4" />
                    Kei Light
                </Button>
            {/if}
            <Button
                variant="outline"
                size="sm"
                class="gap-1.5"
                disabled={!$activePersona}
                onclick={() =>
                    $activePersona &&
                    exportPersonaFile($activePersona.id, {
                        kind: 'keipersona',
                        assetMode: 'baked'
                    })}
                title="Export Kei Baked"
            >
                <Download class="size-4" />
                Kei Baked
            </Button>
            <Button variant="destructive" size="sm" class="gap-1.5" onclick={handleDelete}>
                <Trash2 class="size-4" />
                Delete
            </Button>
            <Button variant="outline" size="sm" onclick={backToContext}>Close Studio</Button>
        </div>
    </header>

    <div class="flex min-h-0 flex-1 overflow-hidden">
        <nav class="flex w-64 shrink-0 flex-col gap-1 border-r bg-muted/30 p-4">
            <button
                class="flex items-center gap-3 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow-sm"
            >
                <UserRound class="size-4" />
                Profile
            </button>
        </nav>

        <main class="flex min-h-0 flex-1 flex-col overflow-hidden">
            {#if !$activePersona}
                <div class="flex flex-1 items-center justify-center">
                    <p class="text-muted-foreground">Loading persona data...</p>
                </div>
            {:else}
                <ScrollArea class="min-h-0 flex-1">
                    <div class="mx-auto max-w-4xl p-8">
                        <section class="space-y-6">
                            <Card>
                                <CardHeader>
                                    <CardTitle>Basic Information</CardTitle>
                                    <CardDescription>
                                        How this persona appears in chats and prompt context.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent class="space-y-6">
                                    <div class="flex items-center gap-6">
                                        <div class="group relative">
                                            <div
                                                class="size-24 overflow-hidden rounded-full border-2 border-primary/20 bg-muted"
                                            >
                                                <AssetView
                                                    id={$activePersona.avatarAssetId}
                                                    alt={$activePersona.name}
                                                    class="size-full object-cover"
                                                    fallback="none"
                                                >
                                                    {#if !$activePersona.avatarAssetId}
                                                        <div
                                                            class="flex size-full items-center justify-center"
                                                        >
                                                            <User
                                                                class="size-10 text-muted-foreground/50"
                                                            />
                                                        </div>
                                                    {/if}
                                                </AssetView>
                                            </div>
                                            <button
                                                class="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 text-white opacity-0 transition-opacity group-hover:opacity-100"
                                                onclick={() => avatarInput?.click()}
                                                title="Upload avatar"
                                            >
                                                <Upload class="size-6" />
                                            </button>
                                            <input
                                                bind:this={avatarInput}
                                                type="file"
                                                accept="image/*"
                                                class="hidden"
                                                onchange={handleAvatarUpload}
                                            />
                                        </div>

                                        <div class="flex-1 space-y-4">
                                            <div class="grid gap-1.5">
                                                <Label>Persona Name</Label>
                                                <Input
                                                    value={$activePersona.name}
                                                    oninput={(e) =>
                                                        updatePersona($activePersona!.id, {
                                                            name: e.currentTarget.value
                                                        })}
                                                    placeholder="Enter persona name..."
                                                />
                                            </div>
                                            <div class="flex items-center gap-2">
                                                <Button
                                                    variant="destructive"
                                                    size="sm"
                                                    disabled={!$activePersona.avatarAssetId}
                                                    onclick={() =>
                                                        removePersonaAvatar($activePersona!.id)}
                                                >
                                                    Remove Avatar
                                                </Button>
                                            </div>
                                        </div>
                                    </div>

                                    <div class="grid gap-1.5">
                                        <Label>Persona Description</Label>
                                        <Textarea
                                            rows={5}
                                            value={$activePersona.description}
                                            oninput={(e) =>
                                                updatePersona($activePersona!.id, {
                                                    description: e.currentTarget.value
                                                })}
                                            placeholder="Describe how this persona should speak, act, or be represented..."
                                        />
                                        <p class="text-xs text-muted-foreground">
                                            Used for persona prompt blocks and chat participant
                                            context.
                                        </p>
                                    </div>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader>
                                    <CardTitle>Runtime Identity</CardTitle>
                                    <CardDescription>
                                        This persona can be attached to chats and selected as the
                                        user speaker.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div class="flex items-center gap-3 rounded-md border p-4">
                                        <div
                                            class="flex size-10 items-center justify-center rounded-md bg-muted text-muted-foreground"
                                        >
                                            <IdCard class="size-5" />
                                        </div>
                                        <div class="min-w-0">
                                            <p class="text-sm font-medium">Speaker identity</p>
                                            <p class="text-xs text-muted-foreground">
                                                Messages keep their own speaker snapshot; this
                                                record edits future context.
                                            </p>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </section>
                    </div>
                </ScrollArea>
            {/if}
        </main>
    </div>
</div>
