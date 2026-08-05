<script lang="ts">
    import { Label } from '$lib/components/ui/label';
    import { Textarea } from '$lib/components/ui/textarea';
    import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
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

<section class="space-y-6">
    <Card>
        <CardHeader>
            <CardTitle>Chat Display</CardTitle>
        </CardHeader>
        <CardContent class="space-y-6">
            <div class="grid gap-1.5">
                <Label for="module-background-html">Background HTML</Label>
                <Textarea
                    id="module-background-html"
                    rows={12}
                    value={module.backgroundHTML}
                    oninput={(e) => onUpdate({ backgroundHTML: e.currentTarget.value })}
                    placeholder="&lt;style&gt;...&lt;/style&gt;"
                    class="font-mono text-sm"
                />
                <p class="text-xs text-muted-foreground">
                    Rendered behind the chat surface when this module is active.
                </p>
            </div>

            <div class="grid gap-1.5">
                <Label for="module-message-css">Message CSS</Label>
                <Textarea
                    id="module-message-css"
                    rows={12}
                    value={module.messageCSS}
                    oninput={(e) => onUpdate({ messageCSS: e.currentTarget.value })}
                    placeholder=".status-panel &#123; ... &#125;"
                    class="font-mono text-sm"
                />
                <p class="text-xs text-muted-foreground">
                    CSS body only. It is scoped to messages rendered for this module.
                </p>
            </div>
        </CardContent>
    </Card>
</section>
