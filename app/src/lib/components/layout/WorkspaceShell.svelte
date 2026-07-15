<script lang="ts" generics="SectionId extends string">
    import { ChevronLeft, ChevronRight, X, type IconProps } from 'lucide-svelte';
    import type { ComponentType, Snippet, SvelteComponent } from 'svelte';
    import { Button } from '$lib/components/ui/button';

    interface WorkspaceSection<Id extends string> {
        id: Id;
        label: string;
        icon: ComponentType<SvelteComponent<IconProps>>;
    }

    interface Props {
        workspaceName: string;
        entityName?: string;
        sections: readonly WorkspaceSection<SectionId>[];
        activeSection: SectionId;
        showDetail: boolean;
        onSelect: (section: SectionId) => void;
        onBack: () => void;
        onClose: () => void;
        closeLabel: string;
        identity?: Snippet<[sizeClass: string]>;
        children: Snippet;
    }

    let {
        workspaceName,
        entityName,
        sections,
        activeSection,
        showDetail,
        onSelect,
        onBack,
        onClose,
        closeLabel,
        identity,
        children
    }: Props = $props();

    let activeSectionLabel = $derived(
        sections.find((section) => section.id === activeSection)?.label ?? workspaceName
    );
</script>

<div class="flex h-full min-h-0 flex-col bg-background">
    <div class="flex min-h-0 flex-1 overflow-hidden">
        <nav
            class="min-h-0 w-full shrink-0 flex-col border-r bg-muted/30 md:flex md:min-w-64 md:w-[max(16rem,calc((100vw-72rem)/2+16rem))] {showDetail
                ? 'hidden'
                : 'flex'}"
            aria-label={`${workspaceName} sections`}
        >
            <div class="flex h-14 shrink-0 items-center border-b px-2 md:hidden">
                {#if identity}
                    {@render identity('size-8')}
                {/if}
                <div class="min-w-0 flex-1 px-2">
                    <h1 class="truncate text-sm font-semibold">{entityName ?? workspaceName}</h1>
                    {#if entityName}
                        <p class="text-[11px] text-muted-foreground">{workspaceName}</p>
                    {/if}
                </div>
                <Button variant="ghost" size="icon" onclick={onClose} aria-label={closeLabel}>
                    <X class="size-5" />
                </Button>
            </div>

            <div
                class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-4 md:ml-auto md:w-64 md:flex-none md:px-4 md:pb-4 md:pt-8"
            >
                {#if identity && entityName}
                    <div class="mb-4 hidden items-center gap-3 px-3 md:flex">
                        {@render identity('size-10')}
                        <div class="min-w-0">
                            <p class="truncate text-sm font-medium">{entityName}</p>
                            <p class="text-xs text-muted-foreground">{workspaceName}</p>
                        </div>
                    </div>
                {/if}

                {#each sections as section (section.id)}
                    <button
                        type="button"
                        class="flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors md:min-h-0 {activeSection ===
                        section.id
                            ? showDetail
                                ? 'bg-primary text-primary-foreground shadow-sm'
                                : 'text-muted-foreground hover:bg-muted hover:text-foreground md:bg-primary md:text-primary-foreground md:shadow-sm'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
                        onclick={() => onSelect(section.id)}
                        aria-current={activeSection === section.id ? 'page' : undefined}
                    >
                        <section.icon class="size-4" />
                        <span>{section.label}</span>
                        <ChevronRight class="ml-auto size-4 md:hidden" />
                    </button>
                {/each}
            </div>
        </nav>

        <main
            class="relative min-h-0 flex-1 flex-col overflow-hidden bg-background md:flex {showDetail
                ? 'flex'
                : 'hidden'}"
        >
            <div
                class="flex h-14 w-full max-w-4xl shrink-0 items-center border-b px-2 md:mt-4 md:border-b-0 md:px-8"
            >
                <Button
                    variant="ghost"
                    size="icon"
                    class="md:hidden"
                    onclick={onBack}
                    aria-label={`Back to ${workspaceName} sections`}
                >
                    <ChevronLeft class="size-5" />
                </Button>
                {#if identity}
                    <div class="md:hidden">{@render identity('size-8')}</div>
                {/if}
                <div class="min-w-0 flex-1 px-2 md:px-0">
                    <h1 class="truncate text-sm font-semibold md:text-xl">{activeSectionLabel}</h1>
                    {#if entityName}
                        <p class="hidden truncate text-xs text-muted-foreground md:block">
                            {entityName}
                        </p>
                    {/if}
                </div>
                <Button variant="ghost" size="icon" onclick={onClose} aria-label={closeLabel}>
                    <X class="size-5" />
                </Button>
            </div>

            {@render children()}
        </main>
    </div>
</div>
