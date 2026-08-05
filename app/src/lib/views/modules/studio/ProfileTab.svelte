<script lang="ts">
    import { Input } from '$lib/components/ui/input';
    import { Label } from '$lib/components/ui/label';
    import { Textarea } from '$lib/components/ui/textarea';
    import {
        Card,
        CardContent,
        CardHeader,
        CardTitle,
        CardDescription
    } from '$lib/components/ui/card';
    import type { Module, ModuleContent } from '$lib/services';
    import type { DeepPartial } from '$lib/utils/defaults';

    let {
        module,
        onUpdate
    }: {
        module: Module;
        onUpdate: (changes: DeepPartial<ModuleContent>) => void | Promise<void>;
    } = $props();
</script>

<section class="space-y-5">
    <Card>
        <CardHeader>
            <CardTitle>Basic Information</CardTitle>
            <CardDescription>How the module is identified in the application.</CardDescription>
        </CardHeader>
        <CardContent class="space-y-4">
            <div class="grid gap-1.5">
                <Label for="module-name">Module Name</Label>
                <Input
                    id="module-name"
                    value={module.name}
                    oninput={(e) => onUpdate({ name: e.currentTarget.value })}
                    placeholder="Enter module name..."
                />
            </div>

            <div class="grid gap-1.5">
                <Label for="module-description">Description</Label>
                <Textarea
                    id="module-description"
                    rows={3}
                    value={module.description}
                    oninput={(e) => onUpdate({ description: e.currentTarget.value })}
                    placeholder="A short description of what this module provides..."
                />
                <p class="text-xs text-muted-foreground">
                    Used for module lists and library cards.
                </p>
            </div>
        </CardContent>
    </Card>
</section>
