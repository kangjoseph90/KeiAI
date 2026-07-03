import { writable, derived, get } from 'svelte/store';

// ─── Route Types ──────────────────────────────────────────────────────

export type ViewMode =
    | 'home'
    | 'multiRoom'
    | 'room'
    | 'characterStudio'
    | 'personaStudio'
    | 'settings';
export type SettingsTab =
    | 'models'
    | 'chat'
    | 'modules'
    | 'plugins'
    | 'language'
    | 'profile'
    | 'account'
    | 'appearance';
export type CharacterStudioTab =
    | 'profile'
    | 'greetings'
    | 'prompt'
    | 'lorebooks'
    | 'scripts'
    | 'assets'
    | 'advanced'
    | 'export';
export type PersonaStudioTab = 'profile' | 'assets' | 'export';

export interface RouteState {
    view: ViewMode;
    roomId?: string;
    charId?: string;
    chatId?: string;
    personaId?: string;
    pluginId?: string;
    moduleId?: string;
    settingsTab?: SettingsTab;
    characterTab?: CharacterStudioTab;
    personaTab?: PersonaStudioTab;
}

// ─── URL Scheme ───────────────────────────────────────────────────────
// #/                          → home
// #/multi-room               → multi-room management
// #/room/{roomId}             → room, no chat selected
// #/room/{roomId}/chat/{chatId} → room with a selected chat
// #/character/{charId}/{tab?} → character studio
// #/persona/{personaId}/{tab?} → persona studio
// #/settings                  → global settings
// #/settings/{tab}            → global settings focused on a tab
// #/settings/plugins/{pluginId} → settings plugin editor
// #/settings/modules/{moduleId} → settings module editor

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
        case 'personaStudio':
            if (route.personaId && route.personaTab) {
                return `#/persona/${route.personaId}/${route.personaTab}`;
            }
            return route.personaId ? `#/persona/${route.personaId}` : '#/';
        case 'settings':
            if (route.pluginId) return `#/settings/plugins/${route.pluginId}`;
            if (route.moduleId) return `#/settings/modules/${route.moduleId}`;
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
            characterTab === 'prompt' ||
            characterTab === 'lorebooks' ||
            characterTab === 'scripts' ||
            characterTab === 'assets' ||
            characterTab === 'advanced' ||
            characterTab === 'export'
        ) {
            return { view: 'characterStudio', charId: parts[1], characterTab };
        }
        return { view: 'characterStudio', charId: parts[1] };
    }
    if (parts[0] === 'persona' && parts[1]) {
        const personaTab = parts[2];
        if (personaTab === 'profile' || personaTab === 'assets' || personaTab === 'export') {
            return { view: 'personaStudio', personaId: parts[1], personaTab };
        }
        return { view: 'personaStudio', personaId: parts[1] };
    }
    if (parts[0] === 'settings') {
        if (parts[1] === 'plugins' && parts[2]) {
            return { view: 'settings', settingsTab: 'plugins', pluginId: parts[2] };
        }
        if (parts[1] === 'modules' && parts[2]) {
            return { view: 'settings', settingsTab: 'modules', moduleId: parts[2] };
        }
        if (
            parts[1] === 'models' ||
            parts[1] === 'chat' ||
            parts[1] === 'modules' ||
            parts[1] === 'plugins' ||
            parts[1] === 'language' ||
            parts[1] === 'profile' ||
            parts[1] === 'account' ||
            parts[1] === 'appearance'
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
            parsed.moduleId !== current.moduleId ||
            parsed.settingsTab !== current.settingsTab ||
            parsed.characterTab !== current.characterTab ||
            parsed.personaTab !== current.personaTab
        ) {
            _route.set(parsed);
        }
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
}
