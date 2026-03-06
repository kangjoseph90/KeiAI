import { writable, derived, get } from 'svelte/store';

// ─── Route Types ──────────────────────────────────────────────────────

export type ViewMode =
	| 'characters'
	| 'chats'
	| 'chat'
	| 'personas'
	| 'presets'
	| 'modules'
	| 'plugins'
	| 'settings';

export interface RouteState {
	view: ViewMode;
	charId?: string;
	chatId?: string;
}

// ─── URL Scheme ───────────────────────────────────────────────────────
// #/characters
// #/chats/{charId}
// #/chat/{charId}/{chatId}
// #/personas
// #/presets
// #/modules
// #/plugins
// #/settings

function buildHash(route: RouteState): string {
	switch (route.view) {
		case 'chats':
			return `#/chats/${route.charId}`;
		case 'chat':
			return `#/chat/${route.charId}/${route.chatId}`;
		default:
			return `#/${route.view}`;
	}
}

function parseHash(hash: string): RouteState {
	const path = hash.replace(/^#\//, '');
	const parts = path.split('/');
	const view = parts[0] as ViewMode;

	switch (view) {
		case 'chats':
			return { view: 'chats', charId: parts[1] };
		case 'chat':
			return { view: 'chat', charId: parts[1], chatId: parts[2] };
		case 'personas':
		case 'presets':
		case 'modules':
		case 'plugins':
		case 'settings':
			return { view };
		default:
			return { view: 'characters' };
	}
}

// ─── Store ────────────────────────────────────────────────────────────

const _route = writable<RouteState>({ view: 'characters' });

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
	return parseHash(window.location.hash || '#/characters');
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
