import PocketBase from 'pocketbase';

// Determine if we are in a browser or Node environment (SvelteKit SSR safe)
const isBrowser = typeof window !== 'undefined';

// Connect to the local or remote PocketBase instance
export const pb = new PocketBase(
	import.meta.env.VITE_PB_URL || (isBrowser ? window.location.origin : 'http://127.0.0.1:8090')
);

// Optional: Global hook to handle auth state changes
if (isBrowser) {
	pb.authStore.onChange((token, model) => {
		console.log('PocketBase Auth state changed', model ? `User: ${model.id}` : 'Logged Out');
	});
}
