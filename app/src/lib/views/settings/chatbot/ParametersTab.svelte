<script lang="ts">
    import { ChevronDown, ChevronRight } from 'lucide-svelte';
    import { slide } from 'svelte/transition';
    import { Input } from '$lib/components/ui/input';
    import { Label } from '$lib/components/ui/label';
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
                $appSettings?.tts.workflow,
                $appSettings?.suggestion.workflow,
                $appSettings?.titleGeneration.workflow
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

<div class="space-y-8 pb-8">
    <section class="space-y-4">
        <div>
            <h3 class="text-lg font-semibold tracking-tight text-foreground">Chat Parameters</h3>
            <p class="text-sm text-muted-foreground">
                Fine-tune generation parameters for chat completions.
            </p>
        </div>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
        </div>
    </section>

    <div class="border-t border-border"></div>

    <section class="space-y-4">
        <div class="flex items-center gap-2">
            <button
                type="button"
                class="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onclick={() => (advancedOpen = !advancedOpen)}
                aria-label={advancedOpen ? 'Collapse' : 'Expand'}
            >
                {#if advancedOpen}
                    <ChevronDown class="size-4" />
                {:else}
                    <ChevronRight class="size-4" />
                {/if}
            </button>
            <div>
                <button
                    type="button"
                    class="text-base font-medium text-foreground hover:opacity-80 transition-opacity"
                    onclick={() => (advancedOpen = !advancedOpen)}
                >
                    Model Type Overrides
                </button>
                <p class="text-xs text-muted-foreground">
                    Override parameters for specific agent or workflow roles.
                </p>
            </div>
        </div>

        {#if advancedOpen}
            <div class="pl-6 divide-y divide-border pt-1" transition:slide={{ duration: 150 }}>
                {#each llmTypes as role (role.type)}
                    {@const params = preset.parameters[role.type]}
                    <div class="py-4 space-y-4">
                        <div class="flex items-center justify-between">
                            <div>
                                <h4 class="text-base font-medium text-foreground">{role.type}</h4>
                                {#if role.description}
                                    <p class="text-xs text-muted-foreground">
                                        {role.description}
                                    </p>
                                {/if}
                            </div>
                            <label
                                class="flex items-center gap-2 text-xs font-medium text-muted-foreground cursor-pointer"
                            >
                                <span>Override</span>
                                <input
                                    type="checkbox"
                                    class="size-5 shrink-0 rounded border-primary cursor-pointer"
                                    checked={params !== undefined}
                                    onchange={(e) =>
                                        e.currentTarget.checked
                                            ? enableOverride(role.type)
                                            : disableOverride(role.type)}
                                />
                            </label>
                        </div>
                        {#if params !== undefined}
                            <div transition:slide={{ duration: 150 }}>
                                <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
                                </div>
                            </div>
                        {/if}
                    </div>
                {/each}
            </div>
        {/if}
    </section>
</div>
