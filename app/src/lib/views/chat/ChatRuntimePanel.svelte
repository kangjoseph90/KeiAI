<script lang="ts">
    import {
        Plus,
        Trash2,
        User,
        Settings,
        Book,
        Variable,
        ImageIcon,
        Edit3,
        FileText,
        ChevronRight
    } from 'lucide-svelte';
    import AssetView from '$lib/components/AssetView.svelte';
    import { Button } from '$lib/components/ui/button';
    import { Badge } from '$lib/components/ui/badge';
    import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
    import { Input } from '$lib/components/ui/input';
    import { Label } from '$lib/components/ui/label';
    import { ScrollArea } from '$lib/components/ui/scroll-area';
    import { Separator } from '$lib/components/ui/separator';
    import { Textarea } from '$lib/components/ui/textarea';
    import {
        activeCharacter,
        activeChat,
        chatLorebooks,
        createChatLorebook,
        deleteChatLorebook,
        updateChatContent,
        updateChatLorebook
    } from '$lib/stores';
    import { navigate } from '$lib/router';
    import { getChatVariables } from '$lib/managers';
    import type { ChatContent, Lorebook } from '$lib/services';
    import type { DeepPartial } from '$lib/utils/defaults';
    import LorebookItem from '$lib/views/modules/LorebookItem.svelte';

    interface Props {
        chatId: string;
    }

    let { chatId }: Props = $props();

    let newChatLorebookName = $state('');
    let variables = $state<[string, string][]>([]);

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
            keys: [],
            content: '',
            insertionDepth: 0,
            enabled: true
        });
        newChatLorebookName = '';
    }

    function openCharacterStudio() {
        if ($activeCharacter && $activeChat) {
            navigate({
                view: 'characterStudio',
                charId: $activeCharacter.id,
                chatId: $activeChat.id
            });
        }
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
            <!-- Character Summary -->
            {#if $activeCharacter}
                <section class="space-y-3">
                    <div class="flex items-center gap-3">
                        <div class="size-10 rounded-full overflow-hidden border bg-muted shrink-0">
                            <AssetView
                                id={$activeCharacter.avatarAssetId}
                                class="size-full object-cover"
                            />
                        </div>
                        <div class="flex-1 min-w-0">
                            <h3 class="text-sm font-bold truncate">{$activeCharacter.name}</h3>
                            <p class="text-[10px] text-muted-foreground truncate">
                                Character Blueprint
                            </p>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            class="h-8 px-2 gap-1"
                            onclick={openCharacterStudio}
                        >
                            <Edit3 class="size-3" /> Studio
                        </Button>
                    </div>
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

                    <div class="space-y-2">
                        {#each $chatLorebooks as lb (lb.id)}
                            <LorebookItem
                                item={lb}
                                onUpdate={(id, changes) => updateChatLorebook(chatId, id, changes)}
                                onDelete={(id) => deleteChatLorebook(chatId, id)}
                            />
                        {:else}
                            <p class="text-[10px] text-muted-foreground italic text-center py-2">
                                No chat-specific lorebooks.
                            </p>
                        {/each}
                    </div>
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
            onclick={openCharacterStudio}
        >
            Open Advanced Character Editor
            <ChevronRight class="size-3 transition-transform group-hover:translate-x-0.5" />
        </Button>
    </div>
</div>
