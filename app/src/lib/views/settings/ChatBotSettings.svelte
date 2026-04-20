<script lang="ts">
    /**
     * ChatBotSettings — API keys and model configuration.
     * Extracted from the old SettingsView.
     */
    import { Eye, EyeOff } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import { Input } from '$lib/components/ui/input';
    import { Label } from '$lib/components/ui/label';
    import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
    import { appSettings, updateSettings } from '$lib/stores';

    let openaiKey = $state('');
    let anthropicKey = $state('');
    let showOpenai = $state(false);
    let showAnthropic = $state(false);

    $effect(() => {
        if ($appSettings) {
            openaiKey = $appSettings.openai?.apiKey ?? '';
            anthropicKey = $appSettings.anthropic?.apiKey ?? '';
        }
    });

    function handleKeyChange() {
        updateSettings({
            openai: { apiKey: openaiKey.trim() },
            anthropic: { apiKey: anthropicKey.trim() }
        });
    }
</script>

<div class="flex flex-col gap-6">
    <h3 class="text-lg font-semibold">Chat Bot Settings</h3>

    <!-- API Keys -->
    <Card>
        <CardHeader>
            <CardTitle class="text-base">API Keys</CardTitle>
        </CardHeader>
        <CardContent class="flex flex-col gap-4">
            <div class="flex flex-col gap-1.5">
                <Label for="openai-key">OpenAI API Key</Label>
                <div class="flex gap-2">
                    <Input
                        id="openai-key"
                        type={showOpenai ? 'text' : 'password'}
                        bind:value={openaiKey}
                        oninput={handleKeyChange}
                        placeholder="sk-..."
                        class="flex-1 font-mono text-sm"
                    />
                    <Button size="sm" variant="ghost" onclick={() => (showOpenai = !showOpenai)}>
                        {#if showOpenai}<EyeOff class="size-4" />{:else}<Eye class="size-4" />{/if}
                    </Button>
                </div>
            </div>
            <div class="flex flex-col gap-1.5">
                <Label for="anthropic-key">Anthropic API Key</Label>
                <div class="flex gap-2">
                    <Input
                        id="anthropic-key"
                        type={showAnthropic ? 'text' : 'password'}
                        bind:value={anthropicKey}
                        oninput={handleKeyChange}
                        placeholder="sk-ant-..."
                        class="flex-1 font-mono text-sm"
                    />
                    <Button
                        size="sm"
                        variant="ghost"
                        onclick={() => (showAnthropic = !showAnthropic)}
                    >
                        {#if showAnthropic}<EyeOff class="size-4" />{:else}<Eye
                                class="size-4"
                            />{/if}
                    </Button>
                </div>
            </div>
            <p class="text-xs text-muted-foreground">
                Keys are encrypted with your master key and stored locally. They never leave your
                device unencrypted.
            </p>
        </CardContent>
    </Card>
</div>
