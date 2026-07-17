import { get } from 'svelte/store';
import { ConnectionService } from '$lib/services';
import type { ProxyConnectionSettings, ServerConnectionSettings } from '$lib/types/connections';
import { activeUser, serverTransitionLocked, serverTransitionProgress } from './state';

ConnectionService.onServerTransitionLockChange((locked) => {
    serverTransitionLocked.set(locked);
});

export async function changeServerConnection(settings: ServerConnectionSettings): Promise<void> {
    serverTransitionProgress.set({ phase: 'validating', completed: 0, total: 0 });
    try {
        const updated = await ConnectionService.changeServerConnection(settings, {
            onProgress: (progress) => serverTransitionProgress.set(progress)
        });
        if (get(activeUser)?.id === updated.id) activeUser.set(updated);
    } finally {
        serverTransitionProgress.set(null);
    }
}

export async function changeProxyConnection(settings: ProxyConnectionSettings): Promise<void> {
    const updated = await ConnectionService.changeProxyConnection(settings);
    if (get(activeUser)?.id === updated.id) activeUser.set(updated);
}
