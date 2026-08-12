import { writable, derived, get } from 'svelte/store';

// ─── Route Types ──────────────────────────────────────────────────────

export type ViewMode =
    | 'home'
    | 'multiRoom'
    | 'room'
    | 'characterStudio'
    | 'moduleStudio'
    | 'personaStudio'
    | 'settings';
export type SettingsTab =
    | 'models'
    | 'services'
    | 'chat'
    | 'plugins'
    | 'language'
    | 'profile'
    | 'account'
    | 'connections'
    | 'system'
    | 'general';
export type CharacterStudioTab =
    | 'profile'
    | 'greetings'
    | 'lorebooks'
    | 'scripts'
    | 'display'
    | 'assets'
    | 'advanced';
export type ModuleStudioTab =
    | 'profile'
    | 'lorebooks'
    | 'scripts'
    | 'toggles'
    | 'commands'
    | 'display'
    | 'assets'
    | 'advanced';
export type PersonaStudioTab = 'profile' | 'assets' | 'advanced';

export interface RouteState {
    view: ViewMode;
    roomId?: string;
    charId?: string;
    moduleId?: string;
    chatId?: string;
    personaId?: string;
    settingsTab?: SettingsTab;
    characterTab?: CharacterStudioTab;
    moduleTab?: ModuleStudioTab;
    personaTab?: PersonaStudioTab;
}

// ─── URL Scheme ───────────────────────────────────────────────────────
// #/                          → home
// #/multi-room               → multi-room management
// #/room/{roomId}             → room, no chat selected
// #/room/{roomId}/chat/{chatId} → room with a selected chat
// #/character/{charId}/{tab?} → character studio
// #/module/{moduleId}/{tab?} → module studio
// #/persona/{personaId}/{tab?} → persona studio
// #/settings                  → global settings
// #/settings/{tab}            → global settings focused on a tab

function buildHash(route: RouteState): string {
    switch (route.view) {
        case 'multiRoom':
            return '#/multi-room';
        case 'room':
            if (route.roomId && route.chatId) return `#/room/${route.roomId}/chat/${route.chatId}`;
            if (route.roomId) return `#/room/${route.roomId}`;
            return '#/';
        case 'characterStudio':
            if (route.charId && route.characterTab) {
                return `#/character/${route.charId}/${route.characterTab}`;
            }
            return route.charId ? `#/character/${route.charId}` : '#/';
        case 'moduleStudio':
            if (route.moduleId && route.moduleTab) {
                return `#/module/${route.moduleId}/${route.moduleTab}`;
            }
            return route.moduleId ? `#/module/${route.moduleId}` : '#/';
        case 'personaStudio':
            if (route.personaId && route.personaTab) {
                return `#/persona/${route.personaId}/${route.personaTab}`;
            }
            return route.personaId ? `#/persona/${route.personaId}` : '#/';
        case 'settings':
            if (route.settingsTab) return `#/settings/${route.settingsTab}`;
            return '#/settings';
        default:
            return '#/';
    }
}

function parseHash(hash: string): RouteState {
    const path = hash.replace(/^#\//, '');
    if (!path || path === '/') return { view: 'home' };
    if (path === 'multi-room') return { view: 'multiRoom' };

    if (path === 'settings') return { view: 'settings' };

    const parts = path.split('/');
    if (parts[0] === 'room') {
        const roomId = parts[1];
        const chatId = parts[2] === 'chat' ? parts[3] : undefined;
        if (roomId) return { view: 'room', roomId, chatId };
    }
    if (parts[0] === 'character' && parts[1]) {
        const characterTab = parts[2];
        if (
            characterTab === 'profile' ||
            characterTab === 'greetings' ||
            characterTab === 'lorebooks' ||
            characterTab === 'scripts' ||
            characterTab === 'display' ||
            characterTab === 'assets' ||
            characterTab === 'advanced'
        ) {
            return { view: 'characterStudio', charId: parts[1], characterTab };
        }
        return { view: 'characterStudio', charId: parts[1] };
    }
    if (parts[0] === 'module' && parts[1]) {
        const moduleTab = parts[2];
        if (
            moduleTab === 'profile' ||
            moduleTab === 'lorebooks' ||
            moduleTab === 'scripts' ||
            moduleTab === 'toggles' ||
            moduleTab === 'commands' ||
            moduleTab === 'display' ||
            moduleTab === 'assets' ||
            moduleTab === 'advanced'
        ) {
            return { view: 'moduleStudio', moduleId: parts[1], moduleTab };
        }
        return { view: 'moduleStudio', moduleId: parts[1] };
    }
    if (parts[0] === 'persona' && parts[1]) {
        const personaTab = parts[2];
        if (personaTab === 'profile' || personaTab === 'assets' || personaTab === 'advanced') {
            return { view: 'personaStudio', personaId: parts[1], personaTab };
        }
        return { view: 'personaStudio', personaId: parts[1] };
    }
    if (parts[0] === 'settings') {
        if (
            parts[1] === 'models' ||
            parts[1] === 'services' ||
            parts[1] === 'chat' ||
            parts[1] === 'plugins' ||
            parts[1] === 'language' ||
            parts[1] === 'profile' ||
            parts[1] === 'account' ||
            parts[1] === 'connections' ||
            parts[1] === 'system' ||
            parts[1] === 'general'
        ) {
            return { view: 'settings', settingsTab: parts[1] };
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

export function resetRouteForReload(): void {
    window.history.replaceState(window.history.state, '', buildHash({ view: 'home' }));
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
            parsed.moduleId !== current.moduleId ||
            parsed.settingsTab !== current.settingsTab ||
            parsed.characterTab !== current.characterTab ||
            parsed.moduleTab !== current.moduleTab ||
            parsed.personaTab !== current.personaTab
        ) {
            _route.set(parsed);
        }
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
}
