import { writable, derived, get } from 'svelte/store';

// ─── Route Types ──────────────────────────────────────────────────────

export type ViewMode = 'home' | 'room' | 'characterStudio' | 'personaStudio' | 'settings';

export interface RouteState {
    view: ViewMode;
    roomId?: string;
    charId?: string;
    chatId?: string;
    personaId?: string;
    pluginId?: string;
    moduleId?: string;
}

// ─── URL Scheme ───────────────────────────────────────────────────────
// #/                          → home
// #/room/{roomId}             → room, no chat selected
// #/room/{roomId}/chat/{chatId} → room with a selected chat
// #/character/{charId}        → character studio
// #/persona/{personaId}       → persona studio
// #/settings                  → global settings
// #/settings/plugin/{pluginId} → settings plugin editor
// #/settings/module/{moduleId} → settings module editor

function buildHash(route: RouteState): string {
    switch (route.view) {
        case 'room':
            if (route.roomId && route.chatId) return `#/room/${route.roomId}/chat/${route.chatId}`;
            if (route.roomId) return `#/room/${route.roomId}`;
            return '#/';
        case 'characterStudio':
            return route.charId ? `#/character/${route.charId}` : '#/';
        case 'personaStudio':
            return route.personaId ? `#/persona/${route.personaId}` : '#/';
        case 'settings':
            if (route.pluginId) return `#/settings/plugin/${route.pluginId}`;
            if (route.moduleId) return `#/settings/module/${route.moduleId}`;
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
    if (parts[0] === 'room') {
        const roomId = parts[1];
        const chatId = parts[2] === 'chat' ? parts[3] : undefined;
        if (roomId) return { view: 'room', roomId, chatId };
    }
    if (parts[0] === 'character' && parts[1]) {
        return { view: 'characterStudio', charId: parts[1] };
    }
    if (parts[0] === 'persona' && parts[1]) {
        return { view: 'personaStudio', personaId: parts[1] };
    }
    if (parts[0] === 'settings') {
        if (parts[1] === 'plugin' && parts[2]) {
            return { view: 'settings', pluginId: parts[2] };
        }
        if (parts[1] === 'module' && parts[2]) {
            return { view: 'settings', moduleId: parts[2] };
        }
        return { view: 'settings' };
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
            parsed.roomId !== current.roomId ||
            parsed.charId !== current.charId ||
            parsed.chatId !== current.chatId ||
            parsed.personaId !== current.personaId ||
            parsed.pluginId !== current.pluginId ||
            parsed.moduleId !== current.moduleId
        ) {
            _route.set(parsed);
        }
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
}
