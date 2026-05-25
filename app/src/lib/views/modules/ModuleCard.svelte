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
        createModuleFolder,
        updateModuleFolder,
        deleteModuleFolder,
        moveModuleItem
    } from '$lib/stores';
    import { navigate } from '$lib/router';
    import type { Module, Lorebook, Script, CharJS } from '$lib/services';
    import type { DeepPartial } from '$lib/utils/defaults';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import { Textarea } from '$lib/components/ui/textarea';
    import { Card, CardContent } from '$lib/components/ui/card';
    import { Badge } from '$lib/components/ui/badge';
    import { Label } from '$lib/components/ui/label';
    import { Separator } from '$lib/components/ui/separator';
    import { ArrowLeft, BookOpen, Check, Code, FileCode, Plus, Trash2 } from 'lucide-svelte';
    import LorebookItem from './LorebookItem.svelte';
    import ScriptItem from './ScriptItem.svelte';
    import CharJSItem from './CharJSItem.svelte';
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
        navigate({ view: 'settings' });
    }

    async function handleDeleteModule() {
        await deleteModule(mod.id);
        navigate({ view: 'settings' });
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

<div class="flex min-h-[70vh] flex-col gap-5">
    <div class="flex items-center justify-between gap-3">
        <div class="flex min-w-0 items-center gap-3">
            <Button variant="ghost" size="icon" onclick={() => navigate({ view: 'settings' })}>
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
                    onCreateFolder={(name, parentId) =>
                        createModuleFolder(mod.id, 'lorebooks', name, parentId)}
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
                    onCreateFolder={(name, parentId) =>
                        createModuleFolder(mod.id, 'scripts', name, parentId)}
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
                    onCreateFolder={(name, parentId) =>
                        createModuleFolder(mod.id, 'charjs', name, parentId)}
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
