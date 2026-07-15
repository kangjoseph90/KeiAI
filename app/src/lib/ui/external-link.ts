import type { Action } from 'svelte/action';
import { appExternal, normalizeExternalUrl } from '$lib/adapters/external';
import { getErrorMessage } from '$lib/types/errors';
import { toast } from './toast';

const LINK_SELECTOR = 'a[href]';

export async function openExternalLink(url: string): Promise<boolean> {
    try {
        await appExternal.openUrl(url);
        return true;
    } catch (error) {
        toast.error({
            title: 'Could not open link',
            description: getErrorMessage(error, 'The link could not be opened.')
        });
        return false;
    }
}

export const externalLinks: Action<HTMLElement, string | undefined> = (node) => {
    function prepareLinks(): void {
        node.querySelectorAll<HTMLAnchorElement>(LINK_SELECTOR).forEach((anchor) => {
            const href = anchor.getAttribute('href');
            if (!href || href.startsWith('#')) return;

            try {
                normalizeExternalUrl(href);
                anchor.target = '_blank';
                anchor.rel = 'noopener noreferrer';
            } catch {
                anchor.removeAttribute('href');
                anchor.removeAttribute('target');
            }
        });
    }

    function handleClick(event: MouseEvent): void {
        if (event.defaultPrevented || event.button !== 0) return;
        if (!(event.target instanceof Element)) return;

        const anchor = event.target.closest<HTMLAnchorElement>(LINK_SELECTOR);
        if (!anchor || !node.contains(anchor)) return;

        const href = anchor.getAttribute('href');
        if (!href || href.startsWith('#')) return;

        event.preventDefault();
        void openExternalLink(href);
    }

    prepareLinks();
    node.addEventListener('click', handleClick);

    return {
        update: prepareLinks,
        destroy: () => node.removeEventListener('click', handleClick)
    };
};
