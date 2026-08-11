<script lang="ts">
    import { Download, MoreHorizontal, Upload, Workflow } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
    import { replaceWorkflow, type WorkflowDefinition, type WorkflowPatch } from '$lib/workflow';
    import { exportWorkflowFile, importWorkflowFile } from '$lib/managers';
    import { appConfirm, toast } from '$lib/ui';
    import { getErrorMessage } from '$lib/types/errors';

    interface Props {
        workflow: WorkflowDefinition;
        onEditWorkflow: () => void;
        onPatch: (patch: WorkflowPatch) => void | Promise<void>;
        workflowLabel?: string;
        fullWidth?: boolean;
        wide?: boolean;
    }

    let {
        workflow,
        onEditWorkflow,
        onPatch,
        workflowLabel = 'Workflow',
        fullWidth = false,
        wide = false
    }: Props = $props();
    let fileBusy = $state(false);

    // Compute normalized minimap positions for SVG view
    const nodesList = $derived(Object.values(workflow.nodes ?? {}));

    const layout = $derived.by(() => {
        if (nodesList.length === 0) {
            return { nodes: [], connections: [], width: 240, height: 140 };
        }

        let minX = Infinity,
            minY = Infinity,
            maxX = -Infinity,
            maxY = -Infinity;

        for (const n of nodesList) {
            const x = n.position?.x ?? 0;
            const y = n.position?.y ?? 0;
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x + 180 > maxX) maxX = x + 180;
            if (y + 100 > maxY) maxY = y + 100;
        }

        const padding = 35;
        minX -= padding;
        minY -= padding;
        maxX += padding;
        maxY += padding;

        const boundsW = Math.max(maxX - minX, 100);
        const boundsH = Math.max(maxY - minY, 100);

        const viewW = 320;
        const viewH = 160;

        const scaleX = viewW / boundsW;
        const scaleY = viewH / boundsH;
        const scale = Math.min(scaleX, scaleY) * 0.92;

        const offsetX = (viewW - boundsW * scale) / 2;
        const offsetY = (viewH - boundsH * scale) / 2;

        const projectedNodes = nodesList.map((n) => {
            const x = ((n.position?.x ?? 0) - minX) * scale + offsetX;
            const y = ((n.position?.y ?? 0) - minY) * scale + offsetY;
            const w = Math.max(160 * scale, 30);
            const h = Math.max(80 * scale, 18);
            return {
                id: n.id,
                isAgent: n.class === 'Agent',
                x,
                y,
                w,
                h
            };
        });

        const nodeMap = new Map(projectedNodes.map((pn) => [pn.id, pn]));
        const connections: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];

        for (const n of nodesList) {
            const targetProj = nodeMap.get(n.id);
            if (!targetProj || !n.inputs) continue;

            for (const inputKey of Object.keys(n.inputs)) {
                const port = n.inputs[inputKey];
                if (port && port.sourceNode) {
                    const sourceProj = nodeMap.get(port.sourceNode);
                    if (sourceProj) {
                        connections.push({
                            x1: sourceProj.x + sourceProj.w,
                            y1: sourceProj.y + sourceProj.h / 2,
                            x2: targetProj.x,
                            y2: targetProj.y + targetProj.h / 2
                        });
                    }
                }
            }
        }

        return { nodes: projectedNodes, connections, width: viewW, height: viewH };
    });
    // Node and Agent counts
    const agentCount = $derived(nodesList.filter((node) => node.class === 'Agent').length);
    const nodeCount = $derived(nodesList.length);

    async function importWorkflow() {
        if (fileBusy) return;
        fileBusy = true;
        try {
            const imported = await importWorkflowFile();
            if (!imported) return;
            const confirmed = await appConfirm({
                title: 'Replace workflow?',
                description: 'Importing this file will replace every node and connection.',
                confirmText: 'Import'
            });
            if (!confirmed) return;
            await onPatch(replaceWorkflow(workflow, imported).patch);
            toast.success({ title: 'Workflow imported' });
        } catch (error) {
            toast.error({
                title: 'Workflow import failed',
                description: getErrorMessage(error, 'The workflow file could not be imported')
            });
        } finally {
            fileBusy = false;
        }
    }

    async function exportWorkflow() {
        if (fileBusy) return;
        fileBusy = true;
        try {
            const saved = await exportWorkflowFile(workflow, workflowLabel);
            if (saved) toast.success({ title: 'Workflow exported' });
        } catch (error) {
            toast.error({
                title: 'Workflow export failed',
                description: getErrorMessage(error, 'The workflow file could not be exported')
            });
        } finally {
            fileBusy = false;
        }
    }
</script>

<div
    class="group relative flex {fullWidth || wide
        ? 'w-full min-w-0'
        : 'w-80'} flex-col justify-between overflow-hidden rounded-2xl border bg-card p-5 shadow-xs transition-all hover:border-primary/40 hover:shadow-md {wide
        ? 'sm:flex-row sm:items-center sm:gap-6'
        : ''}"
    aria-busy={fileBusy}
>
    <!-- Top-Right Kebab Menu (Always in Grid mode, and on mobile in Wide mode) -->
    <div class="absolute right-3.5 top-3.5 z-20 {wide ? 'sm:hidden' : ''}">
        <DropdownMenu.Root>
            <DropdownMenu.Trigger>
                <Button
                    variant="ghost"
                    size="icon-sm"
                    class="size-8 text-muted-foreground hover:text-foreground"
                    aria-label="Workflow file actions"
                    title="Workflow file actions"
                    disabled={fileBusy}
                >
                    <MoreHorizontal class="size-4" />
                </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end">
                <DropdownMenu.Item onclick={importWorkflow}>
                    <Upload class="size-4" />
                    Import workflow
                </DropdownMenu.Item>
                <DropdownMenu.Item onclick={exportWorkflow}>
                    <Download class="size-4" />
                    Export workflow
                </DropdownMenu.Item>
            </DropdownMenu.Content>
        </DropdownMenu.Root>
    </div>

    <!-- Background xyflow style minimap silhouette container (full fill, blurred, soft opacity) -->
    <div
        class="pointer-events-none absolute inset-0 overflow-hidden opacity-25 blur-[1.5px] transition-all duration-300 group-hover:opacity-40 group-hover:blur-[0.8px]"
    >
        <!-- Dot Grid Pattern -->
        <svg class="absolute inset-0 size-full" aria-hidden="true">
            <defs>
                <pattern
                    id="minimap-dots"
                    x="0"
                    y="0"
                    width="10"
                    height="10"
                    patternUnits="userSpaceOnUse"
                >
                    <circle cx="2" cy="2" r="0.7" class="fill-foreground/25" />
                </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#minimap-dots)" />
        </svg>

        <!-- Minimap Nodes & Connections -->
        <svg class="absolute inset-0 size-full" viewBox="0 0 320 160" fill="none">
            <!-- Connection Lines -->
            {#each layout.connections as conn, idx (idx)}
                <path
                    d="M {conn.x1} {conn.y1} C {conn.x1 + 25} {conn.y1}, {conn.x2 -
                        25} {conn.y2}, {conn.x2} {conn.y2}"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-dasharray="3 3"
                    class="text-foreground/40"
                />
            {/each}

            <!-- Mini Nodes -->
            {#each layout.nodes as node (node.id)}
                <rect
                    x={node.x}
                    y={node.y}
                    width={node.w}
                    height={node.h}
                    rx="4"
                    class={node.isAgent
                        ? 'fill-violet-500/50 stroke-violet-500/80'
                        : 'fill-muted-foreground/30 stroke-muted-foreground/50'}
                    stroke-width="1.5"
                />
            {/each}
        </svg>
    </div>

    <!-- Header / Title area -->
    <div class="relative z-10 flex min-w-0 flex-col gap-1.5 pr-8 {wide ? 'sm:flex-1 sm:pr-0' : ''}">
        <div class="flex items-center gap-2.5">
            <div
                class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
            >
                <Workflow class="size-4" />
            </div>
            <h3 class="truncate text-base font-semibold text-foreground">{workflowLabel}</h3>
        </div>
        <p class="pl-10.5 text-xs font-medium text-muted-foreground/80">
            {agentCount} agent{agentCount === 1 ? '' : 's'} · {nodeCount} node{nodeCount === 1
                ? ''
                : 's'}
        </p>
    </div>

    <!-- Edit Action Button Overlay -->
    <div class="relative z-10 flex items-center gap-2 pt-6 {wide ? 'sm:shrink-0 sm:pt-0' : ''}">
        <Button
            size="sm"
            class="w-full gap-2 whitespace-nowrap font-medium shadow-xs {wide
                ? 'sm:w-auto sm:min-w-32'
                : ''}"
            onclick={onEditWorkflow}
        >
            <Workflow class="size-4" />
            Edit workflow
        </Button>

        {#if wide}
            <div class="hidden sm:block">
                <DropdownMenu.Root>
                    <DropdownMenu.Trigger>
                        <Button
                            variant="outline"
                            size="icon-sm"
                            class="size-8 shrink-0 shadow-2xs"
                            aria-label="Workflow file actions"
                            title="Workflow file actions"
                            disabled={fileBusy}
                        >
                            <MoreHorizontal class="size-4" />
                        </Button>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Content align="end">
                        <DropdownMenu.Item onclick={importWorkflow}>
                            <Upload class="size-4" />
                            Import workflow
                        </DropdownMenu.Item>
                        <DropdownMenu.Item onclick={exportWorkflow}>
                            <Download class="size-4" />
                            Export workflow
                        </DropdownMenu.Item>
                    </DropdownMenu.Content>
                </DropdownMenu.Root>
            </div>
        {/if}
    </div>
</div>
