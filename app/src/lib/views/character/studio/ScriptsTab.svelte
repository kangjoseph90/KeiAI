<script lang="ts">
    import { Code, ImageIcon, Plus } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import { Separator } from '$lib/components/ui/separator';
    import type { Script, CharJS } from '$lib/services';
    import type { DeepPartial } from '$lib/utils/defaults';
    import type { FolderDef, EntityListConfig } from '$lib/types/refs';
    import ScriptItem from '../../modules/ScriptItem.svelte';
    import CharJSItem from '../../modules/CharJSItem.svelte';
    import EntityList from '$lib/components/entitylist/EntityList.svelte';

    interface FolderCallbacks {
        onCreateFolder: (name: string, parentId?: string) => Promise<FolderDef>;
        onUpdateFolder: (
            folderId: string,
            changes: Partial<{ name: string; color: string; parentId: string; sortOrder: string }>
        ) => Promise<void>;
        onDeleteFolder: (folderId: string) => Promise<void>;
        onMoveItem: (itemId: string, newFolderId?: string, newSortOrder?: string) => Promise<void>;
    }

    interface Props {
        scripts: Script[];
        charJS: CharJS[];
        scriptsConfig: EntityListConfig;
        charjsConfig: EntityListConfig;
        onCreateScript: (data: DeepPartial<Script>) => void | Promise<void>;
        onUpdateScript: (id: string, changes: DeepPartial<Script>) => void | Promise<void>;
        onDeleteScript: (id: string) => void | Promise<void>;
        onCreateCharJS: (data: DeepPartial<CharJS>) => void | Promise<void>;
        onUpdateCharJS: (id: string, changes: DeepPartial<CharJS>) => void | Promise<void>;
        onDeleteCharJS: (id: string) => void | Promise<void>;
        scriptFolders: FolderCallbacks;
        charjsFolders: FolderCallbacks;
    }

    let {
        scripts,
        charJS,
        scriptsConfig,
        charjsConfig,
        onCreateScript,
        onUpdateScript,
        onDeleteScript,
        onCreateCharJS,
        onUpdateCharJS,
        onDeleteCharJS,
        scriptFolders,
        charjsFolders
    }: Props = $props();

    let newScriptName = $state('');
    let newCharJSName = $state('');

    async function handleAddScript() {
        if (!newScriptName.trim()) return;
        await onCreateScript({
            name: newScriptName,
            regex: '',
            replacement: '',
            phase: 'input',
            enabled: true,
            advanced: false,
            flag: 'g',
            order: 0,
            repeat: 0
        });
        newScriptName = '';
    }

    async function handleAddCharJS() {
        if (!newCharJSName.trim()) return;
        await onCreateCharJS({
            name: newCharJSName,
            code: '',
            enabled: true
        });
        newCharJSName = '';
    }
</script>

<section class="space-y-6">
    <div class="flex items-center justify-between">
        <div>
            <h2 class="text-lg font-semibold">Scripts & Automation</h2>
            <p class="text-sm text-muted-foreground">
                Regex and JavaScript for advanced message processing.
            </p>
        </div>
        <div class="flex gap-2">
            <Input
                placeholder="Script name..."
                class="w-48 h-9"
                bind:value={newScriptName}
                onkeydown={(e) => e.key === 'Enter' && handleAddScript()}
            />
            <Button size="sm" class="gap-1.5" onclick={handleAddScript}>
                <Plus class="size-4" /> Add
            </Button>
        </div>
    </div>

    <div class="space-y-8">
        <div class="space-y-4">
            <h3 class="text-sm font-semibold flex items-center gap-2">
                <ImageIcon class="size-4" /> Regex Scripts
            </h3>
            <EntityList
                entities={scripts}
                config={scriptsConfig}
                layout="list"
                onCreateFolder={scriptFolders.onCreateFolder}
                onUpdateFolder={scriptFolders.onUpdateFolder}
                onDeleteFolder={scriptFolders.onDeleteFolder}
                onMoveItem={scriptFolders.onMoveItem}
            >
                {#snippet item({ entity: s })}
                    <ScriptItem item={s} onUpdate={onUpdateScript} onDelete={onDeleteScript} />
                {/snippet}
            </EntityList>
        </div>

        <Separator />

        <div class="space-y-4">
            <div class="flex items-center justify-between">
                <h3 class="text-sm font-semibold flex items-center gap-2">
                    <Code class="size-4" /> CharJS Scripts
                </h3>
                <div class="flex gap-2">
                    <Input
                        placeholder="CharJS name..."
                        class="w-40 h-8 text-xs"
                        bind:value={newCharJSName}
                        onkeydown={(e) => e.key === 'Enter' && handleAddCharJS()}
                    />
                    <Button
                        variant="secondary"
                        size="sm"
                        class="h-8 text-xs"
                        onclick={handleAddCharJS}>Add JS</Button
                    >
                </div>
            </div>
            <EntityList
                entities={charJS}
                config={charjsConfig}
                layout="list"
                onCreateFolder={charjsFolders.onCreateFolder}
                onUpdateFolder={charjsFolders.onUpdateFolder}
                onDeleteFolder={charjsFolders.onDeleteFolder}
                onMoveItem={charjsFolders.onMoveItem}
            >
                {#snippet item({ entity: js })}
                    <CharJSItem item={js} onUpdate={onUpdateCharJS} onDelete={onDeleteCharJS} />
                {/snippet}
            </EntityList>
        </div>
    </div>
</section>
