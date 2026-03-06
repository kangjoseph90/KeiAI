import { writable } from 'svelte/store';
import { pb } from '../core/api/pb.js';
import { getActiveSession, hasActiveSession } from '../session.js';

export interface AuthState {
	isLoggedIn: boolean;
	email: string | null;
	userId: string | null;
}

export const authState = writable<AuthState>({
	isLoggedIn: pb.authStore.isValid,
	email: pb.authStore.record?.email ?? null,
	userId: null
});

export function refreshAuthState() {
	const session = hasActiveSession() ? getActiveSession() : null;
	authState.set({
		isLoggedIn: pb.authStore.isValid,
		email: pb.authStore.record?.email ?? null,
		userId: session?.userId ?? null
	});
}

pb.authStore.onChange(() => {
	refreshAuthState();
});
