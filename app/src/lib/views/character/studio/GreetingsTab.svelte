<script lang="ts">
    import { MessageSquare, Plus, Zap, Trash2 } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import { Badge } from '$lib/components/ui/badge';
    import { Textarea } from '$lib/components/ui/textarea';
    import { Card, CardContent, CardHeader } from '$lib/components/ui/card';
    import type { Character } from '$lib/services';

    interface Props {
        character: Character;
        isChatSynced: boolean;
        onCreate: (content: string) => void | Promise<void>;
        onUpdate: (id: string, content: string) => void | Promise<void>;
        onDelete: (id: string) => void | Promise<void>;
    }

    let { character, isChatSynced, onCreate, onUpdate, onDelete }: Props = $props();
    let newGreeting = $state('');

    const sortedGreetings = $derived(() =>
        Object.values(character.greetings ?? {}).sort((a, b) => a.createdAt - b.createdAt)
    );

    async function handleAdd() {
        if (!newGreeting.trim()) return;
        await onCreate(newGreeting);
        newGreeting = '';
    }
</script>

<section class="space-y-6">
    <div class="flex items-center justify-between">
        <div>
            <h2 class="text-lg font-semibold">Greetings</h2>
            <p class="text-sm text-muted-foreground">
                Initial messages that start a new conversation.
            </p>
        </div>
        <div class="flex gap-2">
            <Textarea
                placeholder="New greeting..."
                class="w-64 min-h-[40px] h-[40px] py-2 resize-none"
                bind:value={newGreeting}
                onkeydown={(e) =>
                    e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleAdd())}
            />
            <Button size="sm" class="gap-1.5 h-10" onclick={handleAdd}>
                <Plus class="size-4" /> Add
            </Button>
        </div>
    </div>

    {#if isChatSynced}
        <div class="bg-primary/10 border border-primary/20 rounded-lg p-4 flex items-start gap-3">
            <Zap class="size-5 text-primary shrink-0 mt-0.5" />
            <div class="text-sm">
                <p class="font-medium text-primary">Live Sync Active</p>
                <p class="text-muted-foreground">
                    This chat has not started yet. Editing greetings here will automatically update
                    the first message of your current chat.
                </p>
            </div>
        </div>
    {:else}
        <div class="bg-muted border rounded-lg p-4 flex items-start gap-3">
            <MessageSquare class="size-5 text-muted-foreground shrink-0 mt-0.5" />
            <div class="text-sm">
                <p class="font-medium">Conversation Started</p>
                <p class="text-muted-foreground">
                    Greeting changes won't affect the current chat transcript as it has already
                    progressed.
                </p>
            </div>
        </div>
    {/if}

    <div class="space-y-4">
        {#each sortedGreetings() as g (g.id)}
            <Card>
                <CardHeader class="py-3 flex flex-row items-center justify-between">
                    <Badge variant="secondary" class="font-mono text-[10px]">{g.id}</Badge>
                    <Button
                        variant="ghost"
                        size="icon"
                        class="size-8 text-destructive"
                        onclick={() => onDelete(g.id)}
                    >
                        <Trash2 class="size-4" />
                    </Button>
                </CardHeader>
                <CardContent class="pb-4">
                    <Textarea
                        rows={4}
                        value={g.content}
                        oninput={(e) => onUpdate(g.id, e.currentTarget.value)}
                    />
                </CardContent>
            </Card>
        {/each}
    </div>
</section>
