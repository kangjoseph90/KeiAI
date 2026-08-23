import type { Action } from 'svelte/action';

const SPOILER_SELECTOR = '[data-keiai-spoiler]';

export const spoilerToggles: Action<HTMLElement> = (node) => {
    function handleClick(event: MouseEvent): void {
        if (event.defaultPrevented || event.button !== 0) return;
        if (!(event.target instanceof Element)) return;

        const spoiler = event.target.closest<HTMLElement>(SPOILER_SELECTOR);
        if (!spoiler || !node.contains(spoiler)) return;

        event.preventDefault();
        spoiler.classList.toggle('is-revealed');
    }

    node.addEventListener('click', handleClick);
    return { destroy: () => node.removeEventListener('click', handleClick) };
};
