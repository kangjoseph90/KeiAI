import { writable, derived, get } from 'svelte/store';

// ─── Route Types ──────────────────────────────────────────────────────

export type ViewMode = 'home' | 'chat' | 'characterStudio' | 'settings';

export interface RouteState {
    view: ViewMode;
    charId?: string;
    chatId?: string;
}

// ─── URL Scheme ───────────────────────────────────────────────────────
// #/                          → home (character not selected)
// #/chat/{charId}             → character's active/recent chat
// #/chat/{charId}/{chatId}    → specific chat
// #/chat/{charId}/{chatId}/character → character studio (attached to chat)
// #/settings                  → global settings

function buildHash(route: RouteState): string {
    switch (route.view) {
        case 'chat':
            if (route.chatId) return `#/chat/${route.charId}/${route.chatId}`;
            if (route.charId) return `#/chat/${route.charId}`;
            return '#/';
        case 'characterStudio':
            return `#/chat/${route.charId}/${route.chatId}/character`;
        case 'settings':
            return '#/settings';
        default:
            return '#/';
    }
}

function parseHash(hash: string): RouteState {
    const path = hash.replace(/^#\//, '');
    if (!path || path === '/') return { view: 'home' };

    if (path === 'settings') return { view: 'settings' };

    const parts = path.split('/');
    if (parts[0] === 'chat') {
        const charId = parts[1];
        const chatId = parts[2];
        const sub = parts[3];

        if (charId && chatId) {
            if (sub === 'character') {
                return { view: 'characterStudio', charId, chatId };
            }
            return { view: 'chat', charId, chatId };
        }
        if (charId) return { view: 'chat', charId };
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
