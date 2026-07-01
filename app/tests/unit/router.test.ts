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

        navigate({ view: 'personaStudio', personaId: 'persona-1' });
        expect(window.location.hash).toBe('#/persona/persona-1');
    });

    it('updates the route store from browser history changes', () => {
        const cleanup = initHashListener();
        window.location.hash = '#/multi-room';
        window.dispatchEvent(new HashChangeEvent('hashchange'));

        expect(get(route)).toEqual({ view: 'multiRoom' });
        cleanup();
    });
});
