<script lang="ts">
    import {
        appSettings,
        moduleResources,
        updateModule,
        deleteModule,
        setModuleEnabled,
        createModuleLorebook,
        updateModuleLorebook,
        deleteModuleLorebook,
        createModuleScript,
        updateModuleScript,
        deleteModuleScript,
        createModuleCharJS,
        updateModuleCharJS,
        deleteModuleCharJS
    } from '$lib/stores';
    import type { Module, Lorebook, Script, CharJS } from '$lib/services';
    import type { DeepPartial } from '$lib/utils/defaults';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import { Textarea } from '$lib/components/ui/textarea';
    import { Card, CardContent } from '$lib/components/ui/card';
    import { Badge } from '$lib/components/ui/badge';
    import { Label } from '$lib/components/ui/label';
    import { Separator } from '$lib/components/ui/separator';
    import {
        Check,
        ChevronDown,
        ChevronRight,
        Pencil,
        Plus,
        Trash2,
        X,
        BookOpen,
        FileCode,
        Code
    } from 'lucide-svelte';
    import LorebookItem from './LorebookItem.svelte';
    import ScriptItem from './ScriptItem.svelte';
    import CharJSItem from './CharJSItem.svelte';

    let { mod }: { mod: Module } = $props();

    let enabled = $derived($appSettings?.modules?.refs?.[mod.id]?.enabled ?? true);

    let expanded = $state(false);
    let editing = $state(false);
    let editName = $state('');
    let editDesc = $state('');
    let editAllowLowLevel = $state(false);

    // Reactive arrays synced from nested EntityStore subscriptions
    let lorebooks = $state<Lorebook[]>([]);
    let scripts = $state<Script[]>([]);
    let charjs = $state<CharJS[]>([]);

    $effect(() => {
        if (!expanded) {
            lorebooks = [];
            scripts = [];
            charjs = [];
            return;
        }
        const entry = $moduleResources.get(mod.id);
        if (!entry) return;
        const unsubLb = entry.lorebooks.subscribe((v) => (lorebooks = v));
        const unsubSc = entry.scripts.subscribe((v) => (scripts = v));
        const unsubCjs = entry.charjs.subscribe((v) => (charjs = v));
        return () => {
            unsubLb();
            unsubSc();
            unsubCjs();
        };
    });

    function startEdit() {
        editName = mod.name;
        editDesc = mod.description;
        editAllowLowLevel = mod.allowLowLevel;
        editing = true;
    }

    async function handleSaveModule() {
        if (!editName.trim()) return;
        await updateModule(mod.id, {
            name: editName,
            description: editDesc,
            allowLowLevel: editAllowLowLevel
        });
        editing = false;
    }

    function handleUpdateLorebook(lorebookId: string, changes: DeepPartial<Lorebook>) {
        return updateModuleLorebook(mod.id, lorebookId, changes);
    }

    function handleDeleteLorebook(lorebookId: string) {
        return deleteModuleLorebook(mod.id, lorebookId);
    }

    function handleUpdateScript(scriptId: string, changes: DeepPartial<Script>) {
        return updateModuleScript(mod.id, scriptId, changes);
    }

    function handleDeleteScript(scriptId: string) {
        return deleteModuleScript(mod.id, scriptId);
    }

    function handleUpdateCharJS(charjsId: string, changes: DeepPartial<CharJS>) {
        return updateModuleCharJS(mod.id, charjsId, changes);
    }

    function handleDeleteCharJS(charjsId: string) {
        return deleteModuleCharJS(mod.id, charjsId);
    }
</script>

<Card>
    <CardContent class="p-4">
        <!-- Header -->
        <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-2 min-w-0">
                <button
                    class="p-0.5 rounded hover:bg-accent"
                    onclick={() => {
                        expanded = !expanded;
                        editing = false;
                    }}
                >
                    {#if expanded}
                        <ChevronDown class="size-4" />
                    {:else}
                        <ChevronRight class="size-4" />
                    {/if}
                </button>
                <div class="min-w-0">
                    {#if editing}
                        <div class="flex flex-col gap-3">
                            <div class="space-y-1">
                                <Label>Name</Label>
                                <Input bind:value={editName} />
                            </div>
                            <div class="space-y-1">
                                <Label>Description</Label>
                                <Textarea bind:value={editDesc} rows={2} />
                            </div>
                            <label class="flex items-center gap-2 text-sm">
                                <input type="checkbox" bind:checked={editAllowLowLevel} />
                                Allow Low Level
                            </label>
                            <div class="flex gap-2">
                                <Button size="sm" class="gap-1.5" onclick={handleSaveModule}>
                                    <Check class="size-4" /> Save
                                </Button>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    class="gap-1.5"
                                    onclick={() => (editing = false)}
                                >
                                    <X class="size-4" /> Cancel
                                </Button>
                            </div>
                        </div>
                    {:else}
                        <div>
                            <div class="flex items-center gap-2">
                                <p class="font-medium">{mod.name || 'Unnamed'}</p>
                                {#if !enabled}
                                    <Badge variant="outline" class="text-xs">Disabled</Badge>
                                {/if}
                            </div>
                            {#if mod.description}
                                <p class="text-sm text-muted-foreground line-clamp-1">
                                    {mod.description}
                                </p>
                            {/if}
                        </div>
                    {/if}
                </div>
            </div>
            {#if !editing}
                <div class="flex gap-1 shrink-0 items-center">
                    <label class="flex items-center gap-1.5 text-sm cursor-pointer">
                        <input
                            type="checkbox"
                            checked={enabled}
                            onchange={() => setModuleEnabled(mod.id, !enabled)}
                        />
                    </label>
                    <Button size="sm" variant="outline" onclick={startEdit}>
                        <Pencil class="size-4" />
                    </Button>
                    <Button size="sm" variant="destructive" onclick={() => deleteModule(mod.id)}>
                        <Trash2 class="size-4" />
                    </Button>
                </div>
            {/if}
        </div>

        <!-- Expanded: Sub-resources -->
        {#if expanded}
            <div class="mt-4 flex flex-col gap-4">
                <!-- Lorebooks -->
                <section>
                    <div class="flex items-center justify-between mb-2">
                        <div class="flex items-center gap-2 text-sm font-medium">
                            <BookOpen class="size-4" />
                            Lorebooks
                            <Badge variant="secondary" class="text-xs">{lorebooks.length}</Badge>
                        </div>
                        <Button
                            size="sm"
                            variant="outline"
                            class="gap-1"
                            onclick={() =>
                                createModuleLorebook(mod.id, {
                                    name: 'New Lorebook',
                                    keys: [],
                                    content: '',
                                    enabled: true
                                })}
                        >
                            <Plus class="size-3" /> Add
                        </Button>
                    </div>
                    <div class="flex flex-col gap-1.5">
                        {#each lorebooks as lb (lb.id)}
                            <LorebookItem
                                item={lb}
                                onUpdate={handleUpdateLorebook}
                                onDelete={handleDeleteLorebook}
                            />
                        {/each}
                        {#if lorebooks.length === 0}
                            <p class="text-xs text-muted-foreground px-1">No lorebooks.</p>
                        {/if}
                    </div>
                </section>

                <Separator />

                <!-- Scripts -->
                <section>
                    <div class="flex items-center justify-between mb-2">
                        <div class="flex items-center gap-2 text-sm font-medium">
                            <FileCode class="size-4" />
                            Scripts
                            <Badge variant="secondary" class="text-xs">{scripts.length}</Badge>
                        </div>
                        <Button
                            size="sm"
                            variant="outline"
                            class="gap-1"
                            onclick={() =>
                                createModuleScript(mod.id, {
                                    name: 'New Script',
                                    regex: '',
                                    replacement: '',
                                    phase: 'output',
                                    enabled: true,
                                    advanced: false,
                                    flag: 'gi',
                                    order: 0,
                                    repeat: 0
                                })}
                        >
                            <Plus class="size-3" /> Add
                        </Button>
                    </div>
                    <div class="flex flex-col gap-1.5">
                        {#each scripts as sc (sc.id)}
                            <ScriptItem
                                item={sc}
                                onUpdate={handleUpdateScript}
                                onDelete={handleDeleteScript}
                            />
                        {/each}
                        {#if scripts.length === 0}
                            <p class="text-xs text-muted-foreground px-1">No scripts.</p>
                        {/if}
                    </div>
                </section>

                <Separator />

                <!-- CharJS -->
                <section>
                    <div class="flex items-center justify-between mb-2">
                        <div class="flex items-center gap-2 text-sm font-medium">
                            <Code class="size-4" />
                            CharJS
                            <Badge variant="secondary" class="text-xs">{charjs.length}</Badge>
                        </div>
                        <Button
                            size="sm"
                            variant="outline"
                            class="gap-1"
                            onclick={() =>
                                createModuleCharJS(mod.id, {
                                    name: 'New CharJS',
                                    code: '',
                                    enabled: true
                                })}
                        >
                            <Plus class="size-3" /> Add
                        </Button>
                    </div>
                    <div class="flex flex-col gap-1.5">
                        {#each charjs as cjs (cjs.id)}
                            <CharJSItem
                                item={cjs}
                                onUpdate={handleUpdateCharJS}
                                onDelete={handleDeleteCharJS}
                            />
                        {/each}
                        {#if charjs.length === 0}
                            <p class="text-xs text-muted-foreground px-1">No CharJS.</p>
                        {/if}
                    </div>
                </section>
            </div>
        {/if}
    </CardContent>
</Card>
