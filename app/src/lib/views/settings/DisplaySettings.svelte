<script lang="ts">
    /**
     * DisplaySettings — Theme and display preferences.
     */
    import { RefreshCw } from 'lucide-svelte';
    import { Button } from '$lib/components/ui/button';
    import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
    import { Label } from '$lib/components/ui/label';
    import { appSettings, updateSettings } from '$lib/stores';

    async function handleToggleTheme() {
        const currentTheme = $appSettings?.theme === 'dark' ? 'light' : 'dark';
        await updateSettings({ theme: currentTheme });
    }
</script>

<div class="flex flex-col gap-6">
    <h3 class="text-lg font-semibold">Display Settings</h3>

    <Card>
        <CardHeader>
            <CardTitle class="text-base">Theme</CardTitle>
        </CardHeader>
        <CardContent class="flex flex-col gap-4">
            <div class="flex items-center justify-between">
                <div class="flex flex-col gap-0.5">
                    <Label>Color Theme</Label>
                    <p class="text-xs text-muted-foreground">
                        Current: {$appSettings?.theme === 'dark' ? 'Dark' : 'Light'}
                    </p>
                </div>
                <Button variant="outline" class="gap-1.5" onclick={handleToggleTheme}>
                    <RefreshCw class="size-4" /> Toggle Theme
                </Button>
            </div>
        </CardContent>
    </Card>
</div>
