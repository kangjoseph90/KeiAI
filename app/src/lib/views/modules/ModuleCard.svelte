<script lang="ts">
    import {
        appSettings,
        activeModule,
        moduleLorebooks,
        moduleScripts,
        moduleCharJS,
        selectModule,
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
        deleteModuleCharJS,
        createModuleAsset,
        deleteModuleAsset,
        createModuleFolder,
        updateModuleFolder,
        deleteModuleFolder,
        moveModuleItem
    } from '$lib/stores';
    import { navigate } from '$lib/router';
    import type { Module, Lorebook, Script, CharJS } from '$lib/services';
    import type { AssetRef } from '$lib/types/refs';
    import type { DeepPartial } from '$lib/utils/defaults';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import { Textarea } from '$lib/components/ui/textarea';
    import { Card, CardContent } from '$lib/components/ui/card';
    import { Badge } from '$lib/components/ui/badge';
    import { Label } from '$lib/components/ui/label';
    import { Separator } from '$lib/components/ui/separator';
    import {
        ArrowLeft,
        BookOpen,
        Check,
        Code,
        FileCode,
        ImageIcon,
        Pencil,
        Plus,
        Trash2
    } from 'lucide-svelte';
    import LorebookItem from './LorebookItem.svelte';
    import ScriptItem from './ScriptItem.svelte';
    import CharJSItem from './CharJSItem.svelte';
    import AssetView from '$lib/components/AssetView.svelte';
    import EntityList from '$lib/components/entitylist/EntityList.svelte';

    let { mod }: { mod: Module } = $props();

    let enabled = $derived($appSettings?.modules.refs[mod.id]?.enabled ?? true);
    let editName = $state('');
    let editDesc = $state('');
    let editBackgroundHTML = $state('');
    let editMessageCSS = $state('');
    let editAllowLowLevel = $state(false);
    let loadedModuleId = $state<string | null>(null);

    let lorebooks = $state<Lorebook[]>([]);
    let scripts = $state<Script[]>([]);
    let charjs = $state<CharJS[]>([]);
    let assetFileInput = $state<HTMLInputElement>();
    let editingAssetId = $state<string | null>(null);
    let editAssetName = $state('');

    $effect(() => {
        const current = $activeModule;
        if (current?.id !== mod.id) {
            void selectModule(mod.id);
            return;
        }

        if (loadedModuleId !== mod.id) {
            loadedModuleId = mod.id;
            editName = current.name;
            editDesc = current.description;
            editBackgroundHTML = current.backgroundHTML;
            editMessageCSS = current.messageCSS;
            editAllowLowLevel = current.allowLowLevel;
        }

        const unsubLb = moduleLorebooks.subscribe((v) => (lorebooks = v));
        const unsubSc = moduleScripts.subscribe((v) => (scripts = v));
        const unsubCjs = moduleCharJS.subscribe((v) => (charjs = v));
        return () => {
            unsubLb();
            unsubSc();
            unsubCjs();
        };
    });

    async function handleSaveModule() {
        if (!editName.trim()) return;
        await updateModule(mod.id, {
            name: editName,
            description: editDesc,
            backgroundHTML: editBackgroundHTML,
            messageCSS: editMessageCSS,
            allowLowLevel: editAllowLowLevel
        });
        navigate({ view: 'settings', settingsTab: 'modules' });
    }

    async function handleDeleteModule() {
        await deleteModule(mod.id);
        navigate({ view: 'settings', settingsTab: 'modules' });
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

    async function handleAssetUpload(event: Event) {
        const target = event.target as HTMLInputElement;
        const file = target.files?.[0];
        if (!file) return;
        await createModuleAsset(mod.id, file);
        target.value = '';
    }

    function startAssetRename(ref: AssetRef) {
        editingAssetId = ref.id;
        editAssetName = ref.name;
    }

    async function saveAssetRename(ref: AssetRef) {
        const val = editAssetName.trim();
        if (val && val !== ref.name) {
            await updateModule(mod.id, {
                assets: {
                    refs: { [ref.id]: { ...ref, name: val } }
                }
            });
        }
        editingAssetId = null;
    }
</script>

<div class="flex min-h-[70vh] flex-col gap-5">
    <div class="flex items-center justify-between gap-3">
        <div class="flex min-w-0 items-center gap-3">
            <Button
                variant="ghost"
                size="icon"
                onclick={() => navigate({ view: 'settings', settingsTab: 'modules' })}
            >
                <ArrowLeft class="size-4" />
            </Button>
            <div class="min-w-0">
                <h2 class="truncate text-xl font-semibold">{mod.name}</h2>
                <p class="text-xs text-muted-foreground">Module editor</p>
            </div>
        </div>
        <div class="flex gap-2">
            <Button variant="destructive" class="gap-1.5" onclick={handleDeleteModule}>
                <Trash2 class="size-4" /> Delete
            </Button>
            <Button class="gap-1.5" onclick={handleSaveModule}>
                <Check class="size-4" /> Save
            </Button>
        </div>
    </div>

    <div class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div class="space-y-5">
            <Card>
                <CardContent class="space-y-4 p-4">
                    <div class="space-y-1">
                        <Label>Name</Label>
                        <Input bind:value={editName} />
                    </div>
                    <div class="space-y-1">
                        <Label>Description</Label>
                        <Textarea bind:value={editDesc} rows={4} />
                    </div>
                    <div class="space-y-1">
                        <Label>Background HTML</Label>
                        <Textarea
                            bind:value={editBackgroundHTML}
                            rows={8}
                            class="font-mono text-sm"
                            placeholder="&lt;style&gt;...&lt;/style&gt;"
                        />
                    </div>
                    <div class="space-y-1">
                        <Label>Message CSS</Label>
                        <Textarea
                            bind:value={editMessageCSS}
                            rows={8}
                            class="font-mono text-sm"
                            placeholder=".status-panel &#123; ... &#125;"
                        />
                    </div>
                    <label class="flex items-center gap-2 text-sm">
                        <input type="checkbox" bind:checked={editAllowLowLevel} />
                        Allow Low Level
                    </label>
                </CardContent>
            </Card>

            <section class="space-y-3">
                <div class="flex items-center justify-between">
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
                                key: '',
                                secondKey: '',
                                content: '',
                                disabled: false
                            })}
                    >
                        <Plus class="size-3" /> Add
                    </Button>
                </div>
                <EntityList
                    entities={lorebooks}
                    config={$activeModule?.lorebooks ?? { refs: {}, folders: {} }}
                    layout="list"
                    onCreateFolder={(name, parentId, sortOrder) =>
                        createModuleFolder(mod.id, 'lorebooks', name, parentId, sortOrder)}
                    onUpdateFolder={(id, changes) =>
                        updateModuleFolder(mod.id, 'lorebooks', id, changes)}
                    onDeleteFolder={(id) => deleteModuleFolder(mod.id, 'lorebooks', id)}
                    onMoveItem={(itemId, newFolderId, newSortOrder) =>
                        moveModuleItem(mod.id, 'lorebooks', itemId, newFolderId, newSortOrder)}
                >
                    {#snippet empty()}
                        <p class="text-xs text-muted-foreground">No lorebooks.</p>
                    {/snippet}
                    {#snippet item({ entity: lb })}
                        <LorebookItem
                            item={lb}
                            onUpdate={handleUpdateLorebook}
                            onDelete={handleDeleteLorebook}
                        />
                    {/snippet}
                </EntityList>
            </section>

            <Separator />

            <section class="space-y-3">
                <div class="flex items-center justify-between">
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
                <EntityList
                    entities={scripts}
                    config={$activeModule?.scripts ?? { refs: {}, folders: {} }}
                    layout="list"
                    onCreateFolder={(name, parentId, sortOrder) =>
                        createModuleFolder(mod.id, 'scripts', name, parentId, sortOrder)}
                    onUpdateFolder={(id, changes) =>
                        updateModuleFolder(mod.id, 'scripts', id, changes)}
                    onDeleteFolder={(id) => deleteModuleFolder(mod.id, 'scripts', id)}
                    onMoveItem={(itemId, newFolderId, newSortOrder) =>
                        moveModuleItem(mod.id, 'scripts', itemId, newFolderId, newSortOrder)}
                >
                    {#snippet empty()}
                        <p class="text-xs text-muted-foreground">No scripts.</p>
                    {/snippet}
                    {#snippet item({ entity: sc })}
                        <ScriptItem
                            item={sc}
                            onUpdate={handleUpdateScript}
                            onDelete={handleDeleteScript}
                        />
                    {/snippet}
                </EntityList>
            </section>

            <Separator />

            <section class="space-y-3">
                <div class="flex items-center justify-between">
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
                <EntityList
                    entities={charjs}
                    config={$activeModule?.charjs ?? { refs: {}, folders: {} }}
                    layout="list"
                    onCreateFolder={(name, parentId, sortOrder) =>
                        createModuleFolder(mod.id, 'charjs', name, parentId, sortOrder)}
                    onUpdateFolder={(id, changes) =>
                        updateModuleFolder(mod.id, 'charjs', id, changes)}
                    onDeleteFolder={(id) => deleteModuleFolder(mod.id, 'charjs', id)}
                    onMoveItem={(itemId, newFolderId, newSortOrder) =>
                        moveModuleItem(mod.id, 'charjs', itemId, newFolderId, newSortOrder)}
                >
                    {#snippet empty()}
                        <p class="text-xs text-muted-foreground">No CharJS.</p>
                    {/snippet}
                    {#snippet item({ entity: cjs })}
                        <CharJSItem
                            item={cjs}
                            onUpdate={handleUpdateCharJS}
                            onDelete={handleDeleteCharJS}
                        />
                    {/snippet}
                </EntityList>
            </section>

            <Separator />

            <section class="space-y-3">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2 text-sm font-medium">
                        <ImageIcon class="size-4" />
                        Assets
                        <Badge variant="secondary" class="text-xs"
                            >{Object.keys($activeModule?.assets?.refs ?? {}).length}</Badge
                        >
                    </div>
                    <Button
                        size="sm"
                        variant="outline"
                        class="gap-1"
                        onclick={() => assetFileInput?.click()}
                    >
                        <Plus class="size-3" /> Add
                    </Button>
                    <input
                        bind:this={assetFileInput}
                        type="file"
                        accept="image/*"
                        class="hidden"
                        onchange={handleAssetUpload}
                    />
                </div>
                <EntityList
                    entities={Object.values($activeModule?.assets?.refs ?? {})}
                    config={$activeModule?.assets ?? { refs: {}, folders: {} }}
                    layout="list"
                    onCreateFolder={(name, parentId, sortOrder) =>
                        createModuleFolder(mod.id, 'assets', name, parentId, sortOrder)}
                    onUpdateFolder={(id, changes) =>
                        updateModuleFolder(mod.id, 'assets', id, changes)}
                    onDeleteFolder={(id) => deleteModuleFolder(mod.id, 'assets', id)}
                    onMoveItem={(itemId, newFolderId, newSortOrder) =>
                        moveModuleItem(mod.id, 'assets', itemId, newFolderId, newSortOrder)}
                >
                    {#snippet empty()}
                        <p class="text-xs text-muted-foreground">No assets.</p>
                    {/snippet}
                    {#snippet item({ entity: ref })}
                        <div
                            class="group flex items-center gap-3 rounded-md border bg-background p-2 transition-colors hover:bg-muted/50"
                        >
                            <div
                                class="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted"
                            >
                                <AssetView
                                    asset={{
                                        scopeType: 'user',
                                        scopeId: '',
                                        ownerTable: 'modules',
                                        ownerId: mod.id,
                                        hash: ref.hash,
                                        encKey: ref.encKey
                                    }}
                                    alt={ref.name}
                                    class="size-full object-cover"
                                    fallback="icon"
                                />
                            </div>
                            <div class="min-w-0 flex-1">
                                {#if editingAssetId === ref.id}
                                    <form
                                        class="flex items-center gap-1.5"
                                        onsubmit={(e) => {
                                            e.preventDefault();
                                            saveAssetRename(ref);
                                        }}
                                    >
                                        <Input
                                            bind:value={editAssetName}
                                            class="h-7 text-xs bg-background w-full"
                                            autofocus
                                            onblur={() => saveAssetRename(ref)}
                                            onkeydown={(e) => {
                                                if (e.key === 'Escape') {
                                                    editingAssetId = null;
                                                }
                                            }}
                                        />
                                    </form>
                                {:else}
                                    <span class="truncate text-sm">{ref.name}</span>
                                    <span class="text-[10px] text-muted-foreground ml-2 font-mono"
                                        >{ref.mimeType}</span
                                    >
                                {/if}
                            </div>
                            <div
                                class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    class="size-7"
                                    title="Rename"
                                    onclick={() => startAssetRename(ref)}
                                >
                                    <Pencil class="size-3" />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    class="size-7 text-destructive hover:text-destructive"
                                    title="Delete"
                                    onclick={() => deleteModuleAsset(mod.id, ref.id)}
                                >
                                    <Trash2 class="size-3" />
                                </Button>
                            </div>
                        </div>
                    {/snippet}
                </EntityList>
            </section>
        </div>

        <aside class="space-y-3">
            <Card>
                <CardContent class="space-y-3 p-4">
                    <label class="flex items-center justify-between gap-3 text-sm">
                        <span>Enabled in global settings</span>
                        <input
                            type="checkbox"
                            checked={enabled}
                            onchange={() => setModuleEnabled(mod.id, !enabled)}
                        />
                    </label>
                </CardContent>
            </Card>
        </aside>
    </div>
</div>
