import PocketBase from 'pocketbase';

// Determine if we are in a browser or Node environment (SvelteKit SSR safe)
const isBrowser = typeof window !== 'undefined';

const pbUrl = import.meta.env.VITE_PB_URL;
if (!pbUrl) {
	throw new Error('VITE_PB_URL environment variable is required');
}

// Connect to the local or remote PocketBase instance
export const pb = new PocketBase(pbUrl);

// Optional: Global hook to handle auth state changes
if (isBrowser) {
	pb.authStore.onChange(() => {
		// Auth state changed — consumed by AuthService.onPbAuthChange
	});
}
