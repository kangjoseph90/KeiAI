<script lang="ts">
    import { Input } from '$lib/components/ui/input';
    import { Label } from '$lib/components/ui/label';
    import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
    import { updatePreset } from '$lib/stores';
    import { type LLMParameter, getLLMParameterName } from '$lib/types/models/llm';
    import type { Preset } from '$lib/services/content/preset';

    interface Props {
        preset: Preset;
    }

    let { preset }: Props = $props();

    const commonParams: LLMParameter[] = [
        'temperature',
        'top_p',
        'top_k',
        'repetition_penalty',
        'presence_penalty',
        'frequency_penalty'
    ];
</script>

<div class="flex flex-col gap-6">
    <Card>
        <CardHeader>
            <CardTitle class="text-base">Context & Response Limits</CardTitle>
        </CardHeader>
        <CardContent class="grid grid-cols-2 gap-6">
            <div class="flex flex-col gap-2">
                <div class="flex items-center justify-between">
                    <Label>Max Context</Label>
                    <span class="text-xs font-mono">{preset.maxContext}</span>
                </div>
                <Input
                    type="number"
                    value={preset.maxContext}
                    oninput={(e) =>
                        updatePreset(preset.id, { maxContext: parseInt(e.currentTarget.value) })}
                />
                <p class="text-[10px] text-muted-foreground">
                    Total tokens allowed for the entire prompt.
                </p>
            </div>
            <div class="flex flex-col gap-2">
                <div class="flex items-center justify-between">
                    <Label>Max Response</Label>
                    <span class="text-xs font-mono">{preset.maxResponse}</span>
                </div>
                <Input
                    type="number"
                    value={preset.maxResponse}
                    oninput={(e) =>
                        updatePreset(preset.id, { maxResponse: parseInt(e.currentTarget.value) })}
                />
                <p class="text-[10px] text-muted-foreground">
                    Limit for the AI's generated response.
                </p>
            </div>
            <div class="flex flex-col gap-2">
                <div class="flex items-center justify-between">
                    <Label>Lorebook Ratio</Label>
                    <span class="text-xs font-mono">{preset.lorebookRatio}</span>
                </div>
                <Input
                    type="number"
                    step="0.05"
                    value={preset.lorebookRatio}
                    oninput={(e) =>
                        updatePreset(preset.id, {
                            lorebookRatio: parseFloat(e.currentTarget.value)
                        })}
                />
                <p class="text-[10px] text-muted-foreground">
                    Budget allocated for lorebook entries (0.0 - 1.0).
                </p>
            </div>
            <div class="flex flex-col gap-2">
                <div class="flex items-center justify-between">
                    <Label>Memory Ratio</Label>
                    <span class="text-xs font-mono">{preset.memoryRatio}</span>
                </div>
                <Input
                    type="number"
                    step="0.05"
                    value={preset.memoryRatio}
                    oninput={(e) =>
                        updatePreset(preset.id, { memoryRatio: parseFloat(e.currentTarget.value) })}
                />
                <p class="text-[10px] text-muted-foreground">
                    Budget allocated for memory/summary (0.0 - 1.0).
                </p>
            </div>
        </CardContent>
    </Card>

    <Card>
        <CardHeader>
            <CardTitle class="text-base">Generation Parameters</CardTitle>
        </CardHeader>
        <CardContent class="grid grid-cols-2 gap-x-8 gap-y-4">
            {#each commonParams as param (param)}
                <div class="flex flex-col gap-1.5">
                    <div class="flex items-center justify-between">
                        <Label class="text-xs">{getLLMParameterName(param)}</Label>
                        <span class="text-[10px] font-mono text-muted-foreground">
                            {preset.chatModel.parameters[param] ?? 'default'}
                        </span>
                    </div>
                    <Input
                        type="number"
                        step="0.01"
                        placeholder="Default"
                        value={preset.chatModel.parameters[param] ?? ''}
                        oninput={(e) => {
                            const val =
                                e.currentTarget.value === ''
                                    ? undefined
                                    : parseFloat(e.currentTarget.value);
                            updatePreset(preset.id, {
                                chatModel: {
                                    parameters: { [param]: val }
                                }
                            });
                        }}
                        class="h-8 text-sm"
                    />
                </div>
            {/each}
        </CardContent>
    </Card>
</div>
