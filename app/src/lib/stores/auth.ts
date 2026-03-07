import { writable } from 'svelte/store';
import { pb } from '../core/api/pb.js';
import { getActiveSession, hasActiveSession } from '../session.js';
import { appUser, type UserRecord } from '../adapters/user/index.js';

export interface AuthState {
	isLoggedIn: boolean;
	email: string | null;
	userId: string | null;
	activeUser: UserRecord | null;
}

export const authState = writable<AuthState>({
	isLoggedIn: pb.authStore.isValid,
	email: pb.authStore.record?.email ?? null,
	userId: null,
	activeUser: null
});

export async function refreshAuthState() {
	const session = hasActiveSession() ? getActiveSession() : null;
	let activeUser = null;
	if (session?.userId) {
		activeUser = await appUser.getUser(session.userId);
	}
	
	authState.set({
		isLoggedIn: pb.authStore.isValid,
		email: pb.authStore.record?.email ?? null,
		userId: session?.userId ?? null,
		activeUser
	});
}

pb.authStore.onChange(() => {
	refreshAuthState();
});
