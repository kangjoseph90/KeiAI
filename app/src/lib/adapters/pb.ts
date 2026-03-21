import PocketBase from 'pocketbase';

// Determine if we are in a browser or Node environment (SvelteKit SSR safe)
const isBrowser = typeof window !== 'undefined';

import { AppError } from '$lib/types/errors';
import { PB_URL } from '$lib/config';

if (!PB_URL) {
	throw new AppError('INVALID_INPUT', 'VITE_PB_URL environment variable is required');
}

// Connect to the local or remote PocketBase instance
export const pb = new PocketBase(PB_URL);

// Optional: Global hook to handle auth state changes
if (isBrowser) {
	pb.authStore.onChange(() => {
		// Auth state changed — consumed by AuthService.onPbAuthChange
	});
}
