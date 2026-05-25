<script lang="ts">
    import { Input } from '$lib/components/ui/input';
    import { Label } from '$lib/components/ui/label';
    import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
    import { updatePreset } from '$lib/stores';
    import {
        BUILT_IN_LLM_TYPES,
        type LLMParameter,
        type LLMType,
        type LLMTypeDefinition,
        getLLMParameterName
    } from '$lib/types/models/llm';
    import { pluginManager } from '$lib/plugins';
    import type { Preset } from '$lib/services/content/preset';

    interface Props {
        preset: Preset;
    }

    let { preset }: Props = $props();
    let advancedOpen = $state(false);

    const commonParams: LLMParameter[] = [
        'temperature',
        'top_p',
        'top_k',
        'repetition_penalty',
        'presence_penalty',
        'frequency_penalty'
    ];

    function collectLLMTypes(): LLMTypeDefinition[] {
        const types = [
            ...BUILT_IN_LLM_TYPES,
            ...pluginManager.getInstances().flatMap((instance) => [...instance.llmTypes.values()])
        ];

        const seen: Record<string, boolean> = {};
        return types.filter((type) => {
            if (seen[type.type]) return false;
            seen[type.type] = true;
            return true;
        });
    }

    function enableOverride(type: LLMType) {
        updatePreset(preset.id, {
            parameters: {
                [type]: {}
            }
        });
    }

    function disableOverride(type: LLMType) {
        updatePreset(preset.id, {
            parameters: {
                [type]: undefined
            }
        });
    }

    function updateParameter(type: LLMType, param: LLMParameter, value: string) {
        updatePreset(preset.id, {
            parameters: {
                [type]: {
                    [param]: value === '' ? undefined : parseFloat(value)
                }
            }
        });
    }
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
                            {preset.parameters.chat?.[param] ?? 'default'}
                        </span>
                    </div>
                    <Input
                        type="number"
                        step="0.01"
                        placeholder="Default"
                        value={preset.parameters.chat?.[param] ?? ''}
                        oninput={(e) => updateParameter('chat', param, e.currentTarget.value)}
                        class="h-8 text-sm"
                    />
                </div>
            {/each}
        </CardContent>
    </Card>

    <Card>
        <CardHeader>
            <CardTitle class="flex items-center justify-between text-base">
                <span>Task Parameter Overrides</span>
                <button
                    type="button"
                    class="text-xs font-normal text-muted-foreground"
                    onclick={() => (advancedOpen = !advancedOpen)}
                >
                    {advancedOpen ? 'Collapse' : 'Expand'}
                </button>
            </CardTitle>
        </CardHeader>

        {#if advancedOpen}
            <CardContent class="flex flex-col gap-4">
                {#each collectLLMTypes() as role (role.type)}
                    {@const params = preset.parameters[role.type]}
                    <div class="rounded-md border p-4">
                        <div class="flex items-start justify-between gap-4">
                            <div>
                                <h4 class="text-sm font-semibold">{role.label}</h4>
                                {#if role.description}
                                    <p class="mt-1 text-xs text-muted-foreground">
                                        {role.description}
                                    </p>
                                {/if}
                            </div>
                            <label class="flex items-center gap-2 text-xs text-muted-foreground">
                                <span>Override</span>
                                <input
                                    type="checkbox"
                                    checked={params !== undefined}
                                    onchange={(e) =>
                                        e.currentTarget.checked
                                            ? enableOverride(role.type)
                                            : disableOverride(role.type)}
                                />
                            </label>
                        </div>

                        {#if params !== undefined}
                            <div class="mt-4 grid grid-cols-2 gap-x-8 gap-y-4">
                                {#each commonParams as param (param)}
                                    <div class="flex flex-col gap-1.5">
                                        <div class="flex items-center justify-between">
                                            <Label class="text-xs"
                                                >{getLLMParameterName(param)}</Label
                                            >
                                            <span
                                                class="text-[10px] font-mono text-muted-foreground"
                                            >
                                                {params[param] ?? 'default'}
                                            </span>
                                        </div>
                                        <Input
                                            type="number"
                                            step="0.01"
                                            placeholder="Use chat default"
                                            value={params[param] ?? ''}
                                            oninput={(e) =>
                                                updateParameter(
                                                    role.type,
                                                    param,
                                                    e.currentTarget.value
                                                )}
                                            class="h-8 text-sm"
                                        />
                                    </div>
                                {/each}
                            </div>
                        {/if}
                    </div>
                {/each}
            </CardContent>
        {/if}
    </Card>
</div>
