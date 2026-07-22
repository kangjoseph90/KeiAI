import type { Action } from 'svelte/action';
import { emitEvent } from '$lib/events';
import type { RuntimeContext } from '$lib/types/context';

const EVENT_BUTTON_SELECTOR = 'button[data-keiai-event]';

export const eventButtons: Action<HTMLElement, RuntimeContext> = (node, initialContext) => {
    let context = initialContext;

    function handleClick(event: MouseEvent): void {
        if (event.defaultPrevented || event.button !== 0) return;
        if (!(event.target instanceof Element)) return;

        const button = event.target.closest<HTMLButtonElement>(EVENT_BUTTON_SELECTOR);
        if (!button || !node.contains(button) || button.disabled) return;

        const eventName = button.dataset.keiaiEvent?.trim();
        if (!eventName) return;

        event.preventDefault();
        void emitEvent(eventName, context);
    }

    node.addEventListener('click', handleClick);

    return {
        update: (nextContext) => {
            context = nextContext;
        },
        destroy: () => node.removeEventListener('click', handleClick)
    };
};
