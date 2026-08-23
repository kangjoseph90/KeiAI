import type { Action } from 'svelte/action';
import { appClipboard } from '$lib/adapters/clipboard';
import { getErrorMessage } from '$lib/types/errors';
import { toast } from './toast';

const COPY_BUTTON_SELECTOR = 'button[data-keiai-copy]';
const COPIED_FEEDBACK_MS = 2000;

export const codeCopy: Action<HTMLElement, string | undefined> = (node, label) => {
    const feedback = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

    function labelButtons(): void {
        const text = label?.trim() || 'Copy code';
        node.querySelectorAll<HTMLButtonElement>(COPY_BUTTON_SELECTOR).forEach((button) => {
            button.setAttribute('aria-label', text);
            button.setAttribute('title', text);
        });
    }

    function handleClick(event: MouseEvent): void {
        if (event.defaultPrevented || event.button !== 0) return;
        if (!(event.target instanceof Element)) return;

        const button = event.target.closest<HTMLButtonElement>(COPY_BUTTON_SELECTOR);
        if (!button || !node.contains(button) || button.disabled) return;

        const source =
            button.closest('.keiai-code-block')?.querySelector('code')?.textContent ?? '';
        event.preventDefault();

        void appClipboard
            .writeText(source)
            .then(() => {
                button.classList.add('is-copied');
                clearTimeout(feedback.get(button));
                feedback.set(
                    button,
                    setTimeout(() => button.classList.remove('is-copied'), COPIED_FEEDBACK_MS)
                );
            })
            .catch((error: unknown) => {
                toast.error({
                    title: 'Copy failed',
                    description: getErrorMessage(error, 'Could not copy code')
                });
            });
    }

    labelButtons();
    node.addEventListener('click', handleClick);

    return {
        update: (nextLabel) => {
            label = nextLabel;
            labelButtons();
        },
        destroy: () => node.removeEventListener('click', handleClick)
    };
};
