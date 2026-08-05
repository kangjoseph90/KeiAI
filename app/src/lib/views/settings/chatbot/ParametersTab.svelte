<script lang="ts">
    import { ChevronDown, ChevronRight } from 'lucide-svelte';
    import { slide } from 'svelte/transition';
    import { Input } from '$lib/components/ui/input';
    import { Label } from '$lib/components/ui/label';
    import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
    import { appSettings, updatePreset } from '$lib/stores';
    import {
        type LLMParameter,
        type LLMParameters,
        type LLMType,
        type LLMTypeDefinition,
        getLLMParameterName
    } from '$lib/types/models/llm';
    import { pluginManager } from '$lib/plugins';
    import type { Preset } from '$lib/services/content/preset';
    import { getWorkflowLLMTypes } from '$lib/workflow/agent/llm';
    import { toast } from '$lib/ui';
    import { getErrorMessage } from '$lib/types/errors';

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

    let llmTypes = $derived.by(() => {
        const definitions: Record<string, LLMTypeDefinition> = {};
        const allTypes = [
            ...pluginManager.getInstances().flatMap((inst) => [...inst.llmTypes.values()]),
            ...[
                preset.chatWorkflow,
                $appSettings?.translation.workflow,
                $appSettings?.imageGeneration.workflow,
                $appSettings?.tts.workflow
            ].flatMap(getWorkflowLLMTypes)
        ].filter((d) => d.type !== 'chat' && d.type !== 'aux');

        for (const d of allTypes) {
            definitions[d.type] = {
                type: d.type,
                description: definitions[d.type]?.description ?? d.description
            };
        }
        return Object.values(definitions);
    });

    async function updateParameters(changes: Parameters<typeof updatePreset>[1]): Promise<void> {
        try {
            await updatePreset(preset.id, changes);
        } catch (error) {
            toast.error({
                title: 'Could not update parameters',
                description: getErrorMessage(error)
            });
        }
    }

    function enableOverride(type: LLMType) {
        void updateParameters({
            parameters: {
                [type]: {}
            }
        });
    }

    function disableOverride(type: LLMType) {
        void updateParameters({
            parameters: {
                [type]: undefined
            }
        });
    }

    function updateParameter(type: LLMType, param: LLMParameter, value: string) {
        void updateParameters({
            parameters: {
                [type]: {
                    [param]: value === '' ? undefined : parseFloat(value)
                }
            }
        });
    }
</script>

<div class="flex flex-col gap-5">
    <Card>
        <CardHeader>
            <CardTitle class="text-base">Chat Parameters</CardTitle>
        </CardHeader>
        <CardContent class="grid grid-cols-3 gap-x-6 gap-y-3">
            {#each commonParams as param (param)}
                <div class="flex flex-col gap-1.5">
                    <Label class="text-xs">{getLLMParameterName(param)}</Label>
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

    <section class="rounded-lg border bg-card p-4">
        <div class="flex items-center gap-2">
            <button
                type="button"
                class="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onclick={() => (advancedOpen = !advancedOpen)}
                aria-label={advancedOpen ? 'Collapse' : 'Expand'}
            >
                {#if advancedOpen}
                    <ChevronDown class="size-3.5" />
                {:else}
                    <ChevronRight class="size-3.5" />
                {/if}
            </button>
            <button
                type="button"
                class="text-sm font-medium text-foreground hover:opacity-80 transition-opacity"
                onclick={() => (advancedOpen = !advancedOpen)}
            >
                Model Type Parameter Overrides
            </button>
        </div>

        {#if advancedOpen}
            <div class="mt-4 flex flex-col gap-3" transition:slide={{ duration: 150 }}>
                {#each llmTypes as role (role.type)}
                    {@const params = preset.parameters[role.type]}
                    <Card>
                        <CardHeader>
                            <CardTitle class="flex items-center justify-between text-base">
                                <div>
                                    <div>{role.type}</div>
                                    {#if role.description}
                                        <p class="mt-0.5 text-xs font-normal text-muted-foreground">
                                            {role.description}
                                        </p>
                                    {/if}
                                </div>
                                <label
                                    class="flex items-center gap-2 text-xs font-normal text-muted-foreground"
                                >
                                    <span>Override</span>
                                    <input
                                        type="checkbox"
                                        class="size-5 shrink-0 rounded border-primary"
                                        checked={params !== undefined}
                                        onchange={(e) =>
                                            e.currentTarget.checked
                                                ? enableOverride(role.type)
                                                : disableOverride(role.type)}
                                    />
                                </label>
                            </CardTitle>
                        </CardHeader>
                        {#if params !== undefined}
                            <div transition:slide={{ duration: 150 }}>
                                <CardContent class="grid grid-cols-3 gap-x-6 gap-y-3">
                                    {#each commonParams as param (param)}
                                        <div class="flex flex-col gap-1.5">
                                            <Label class="text-xs"
                                                >{getLLMParameterName(param)}</Label
                                            >
                                            <Input
                                                type="number"
                                                step="0.01"
                                                placeholder="Default"
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
                                </CardContent>
                            </div>
                        {/if}
                    </Card>
                {/each}
            </div>
        {/if}
    </section>
</div>
