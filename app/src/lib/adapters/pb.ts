import PocketBase from 'pocketbase';

// Determine if we are in a browser or Node environment (SvelteKit SSR safe)
const isBrowser = typeof window !== 'undefined';

import { PB_URL, KEI_PB_URL } from '$lib/config';
import { normalizeUrl } from '$lib/utils/url';

// Connect to the local or remote PocketBase instance
export const pb = new PocketBase(PB_URL);

// Optional: Global hook to handle auth state changes
if (isBrowser) {
    pb.authStore.onChange(() => {
        // Auth state changed — consumed by AuthService.onPbAuthChange
    });
}

export function isKeiServer(): boolean {
    return normalizeUrl(pb.baseUrl) === normalizeUrl(KEI_PB_URL);
}
