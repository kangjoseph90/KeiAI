import { writable, derived, get } from 'svelte/store';

// ─── Route Types ──────────────────────────────────────────────────────

export type ViewMode = 'home' | 'chat';

export interface RouteState {
	view: ViewMode;
	charId?: string;
	chatId?: string;
}

// ─── URL Scheme ───────────────────────────────────────────────────────
// #/                          → home (character not selected)
// #/chat/{charId}             → character's active/recent chat
// #/chat/{charId}/{chatId}    → specific chat

function buildHash(route: RouteState): string {
	switch (route.view) {
		case 'chat':
			if (route.chatId) return `#/chat/${route.charId}/${route.chatId}`;
			if (route.charId) return `#/chat/${route.charId}`;
			return '#/';
		default:
			return '#/';
	}
}

function parseHash(hash: string): RouteState {
	const path = hash.replace(/^#\//, '');
	if (!path || path === '/') return { view: 'home' };

	const parts = path.split('/');
	if (parts[0] === 'chat') {
		if (parts[1] && parts[2]) return { view: 'chat', charId: parts[1], chatId: parts[2] };
		if (parts[1]) return { view: 'chat', charId: parts[1] };
	}
	return { view: 'home' };
}

// ─── Store ────────────────────────────────────────────────────────────

const _route = writable<RouteState>({ view: 'home' });

export const route = derived(_route, (r) => r);

export function navigate(next: RouteState): void {
	_route.set(next);
	const newHash = buildHash(next);
	if (window.location.hash !== newHash) {
		window.location.hash = newHash;
	}
}

// ─── Boot / Hash Change ───────────────────────────────────────────────

export function getCurrentHashRoute(): RouteState {
	return parseHash(window.location.hash || '#/');
}

export function initHashListener(): () => void {
	function onHashChange() {
		const parsed = parseHash(window.location.hash);
		const current = get(_route);
		if (
			parsed.view !== current.view ||
			parsed.charId !== current.charId ||
			parsed.chatId !== current.chatId
		) {
			_route.set(parsed);
		}
	}
	window.addEventListener('hashchange', onHashChange);
	return () => window.removeEventListener('hashchange', onHashChange);
}
