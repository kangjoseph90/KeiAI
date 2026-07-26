import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { getCurrentHashRoute, initHashListener, navigate, route } from '$lib/router';

describe('router', () => {
    beforeEach(() => {
        window.location.hash = '#/';
        navigate({ view: 'home' });
    });

    it('builds and parses the multi-room management route', () => {
        navigate({ view: 'multiRoom' });

        expect(window.location.hash).toBe('#/multi-room');
        expect(getCurrentHashRoute()).toEqual({ view: 'multiRoom' });
    });

    it('keeps room and studio routes scope-neutral', () => {
        navigate({ view: 'room', roomId: 'room-1', chatId: 'chat-1' });
        expect(window.location.hash).toBe('#/room/room-1/chat/chat-1');

        navigate({ view: 'characterStudio', charId: 'char-1' });
        expect(window.location.hash).toBe('#/character/char-1');

        navigate({ view: 'moduleStudio', moduleId: 'module-1' });
        expect(window.location.hash).toBe('#/module/module-1');

        navigate({ view: 'personaStudio', personaId: 'persona-1' });
        expect(window.location.hash).toBe('#/persona/persona-1');
    });

    it('builds and parses character, module, and persona studio tabs', () => {
        navigate({ view: 'characterStudio', charId: 'char-1', characterTab: 'greetings' });
        expect(window.location.hash).toBe('#/character/char-1/greetings');
        expect(getCurrentHashRoute()).toEqual({
            view: 'characterStudio',
            charId: 'char-1',
            characterTab: 'greetings'
        });

        navigate({ view: 'moduleStudio', moduleId: 'module-1', moduleTab: 'scripts' });
        expect(window.location.hash).toBe('#/module/module-1/scripts');
        expect(getCurrentHashRoute()).toEqual({
            view: 'moduleStudio',
            moduleId: 'module-1',
            moduleTab: 'scripts'
        });

        navigate({ view: 'personaStudio', personaId: 'persona-1', personaTab: 'advanced' });
        expect(window.location.hash).toBe('#/persona/persona-1/advanced');
        expect(getCurrentHashRoute()).toEqual({
            view: 'personaStudio',
            personaId: 'persona-1',
            personaTab: 'advanced'
        });
    });

    it('keeps the settings index separate from a selected settings tab', () => {
        navigate({ view: 'settings' });
        expect(window.location.hash).toBe('#/settings');
        expect(getCurrentHashRoute()).toEqual({ view: 'settings' });

        navigate({ view: 'settings', settingsTab: 'models' });
        expect(window.location.hash).toBe('#/settings/models');
        expect(getCurrentHashRoute()).toEqual({ view: 'settings', settingsTab: 'models' });

        navigate({ view: 'settings', settingsTab: 'services' });
        expect(window.location.hash).toBe('#/settings/services');
        expect(getCurrentHashRoute()).toEqual({ view: 'settings', settingsTab: 'services' });

        navigate({ view: 'settings', settingsTab: 'connections' });
        expect(window.location.hash).toBe('#/settings/connections');
        expect(getCurrentHashRoute()).toEqual({ view: 'settings', settingsTab: 'connections' });
    });

    it('updates the route store from browser history changes', () => {
        const cleanup = initHashListener();
        window.location.hash = '#/multi-room';
        window.dispatchEvent(new HashChangeEvent('hashchange'));

        expect(get(route)).toEqual({ view: 'multiRoom' });
        cleanup();
    });
});
