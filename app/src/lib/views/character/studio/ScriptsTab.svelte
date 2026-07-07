<script lang="ts">
    import { Code, ImageIcon, Plus } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import ListActionBar from '$lib/components/ListActionBar.svelte';
    import { Separator } from '$lib/components/ui/separator';
    import type { Script, CharJS } from '$lib/services';
    import type { DeepPartial } from '$lib/utils/defaults';
    import type { FolderDef, EntityListConfig } from '$lib/types/refs';
    import ScriptItem from '../../modules/ScriptItem.svelte';
    import CharJSItem from '../../modules/CharJSItem.svelte';
    import EntityList from '$lib/components/entitylist/EntityList.svelte';
    import EmptyListPlaceholder from '$lib/components/EmptyListPlaceholder.svelte';

    interface FolderCallbacks {
        onCreateFolder: (name: string, parentId?: string, sortOrder?: string) => Promise<FolderDef>;
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
        onCreateScript: (data: DeepPartial<Script>) => Script | Promise<Script>;
        onUpdateScript: (id: string, changes: DeepPartial<Script>) => void | Promise<void>;
        onDeleteScript: (id: string) => void | Promise<void>;
        onCreateCharJS: (data: DeepPartial<CharJS>) => CharJS | Promise<CharJS>;
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
    let editingScriptId = $state<string | null>(null);
    let editingCharJSId = $state<string | null>(null);

    async function handleAddScript() {
        const script = await onCreateScript({
            name: 'New Script',
            regex: '',
            replacement: '',
            phase: 'input',
            enabled: true,
            flag: 'g',
            order: 0,
            repeat: 0
        });
        editingScriptId = script.id;
    }

    async function handleAddCharJS() {
        const charJS = await onCreateCharJS({
            name: 'New Script',
            code: '',
            enabled: true
        });
        editingCharJSId = charJS.id;
    }
</script>

<section class="space-y-6">
    <div class="space-y-8">
        <div class="space-y-4">
            <div class="space-y-1.5">
                <h3 class="text-sm font-semibold flex items-center gap-2">
                    <ImageIcon class="size-4 text-muted-foreground" /> Regex Scripts
                </h3>
                <ListActionBar description="Transform text with regular expressions.">
                    <Button size="sm" class="gap-1.5" onclick={handleAddScript}>
                        <Plus class="size-4" /> Add
                    </Button>
                </ListActionBar>
            </div>
            <EntityList
                entities={scripts}
                config={scriptsConfig}
                layout="list"
                onCreateFolder={scriptFolders.onCreateFolder}
                onUpdateFolder={scriptFolders.onUpdateFolder}
                onDeleteFolder={scriptFolders.onDeleteFolder}
                onMoveItem={scriptFolders.onMoveItem}
            >
                {#snippet empty()}
                    <EmptyListPlaceholder message="No regex scripts." />
                {/snippet}
                {#snippet item({ entity: s })}
                    <ScriptItem
                        item={s}
                        initiallyEditing={editingScriptId === s.id}
                        onUpdate={onUpdateScript}
                        onDelete={onDeleteScript}
                    />
                {/snippet}
            </EntityList>
        </div>

        <Separator />

        <div class="space-y-4">
            <div class="space-y-1.5">
                <h3 class="text-sm font-semibold flex items-center gap-2">
                    <Code class="size-4 text-muted-foreground" /> CharJS Scripts
                </h3>
                <ListActionBar description="Run character-specific JavaScript behavior.">
                    <Button size="sm" class="gap-1.5" onclick={handleAddCharJS}>
                        <Plus class="size-4" /> Add
                    </Button>
                </ListActionBar>
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
                {#snippet empty()}
                    <EmptyListPlaceholder message="No CharJS scripts." />
                {/snippet}
                {#snippet item({ entity: js })}
                    <CharJSItem
                        item={js}
                        initiallyEditing={editingCharJSId === js.id}
                        onUpdate={onUpdateCharJS}
                        onDelete={onDeleteCharJS}
                    />
                {/snippet}
            </EntityList>
        </div>
    </div>
</section>
