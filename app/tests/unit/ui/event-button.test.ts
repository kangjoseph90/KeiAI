import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eventButtons } from '$lib/ui/event-button';
import { emitEvent } from '$lib/events';

vi.mock('$lib/events', () => ({ emitEvent: vi.fn() }));

describe('eventButtons', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('emits the button event with the current runtime context', () => {
        const node = document.createElement('div');
        node.innerHTML = '<button data-keiai-event="choice:accepted"><span>Choose</span></button>';
        const action = eventButtons(node, { chatId: 'chat-1', characterId: 'char-1' });

        node.querySelector('span')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(emitEvent).toHaveBeenCalledWith('choice:accepted', {
            chatId: 'chat-1',
            characterId: 'char-1'
        });
        action?.destroy?.();
    });

    it('ignores disabled buttons and empty event names', () => {
        const node = document.createElement('div');
        node.innerHTML = `
            <button data-keiai-event="disabled" disabled>Disabled</button>
            <button data-keiai-event="  ">Empty</button>
        `;
        const action = eventButtons(node, { chatId: 'chat-1' });

        node.querySelectorAll('button').forEach((button) => button.click());

        expect(emitEvent).not.toHaveBeenCalled();
        action?.destroy?.();
    });
});
