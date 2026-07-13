import { afterEach, describe, expect, it, vi } from 'vitest';
import { openUrl } from '@tauri-apps/plugin-opener';
import { appExternal, normalizeExternalUrl } from '$lib/adapters/external';
import { TauriExternalAdapter } from '$lib/adapters/external/tauri';
import { WebExternalAdapter } from '$lib/adapters/external/web';
import { externalLinks, openExternalLink } from '$lib/ui/external-link';
import { toast } from '$lib/ui/toast';

vi.mock('@tauri-apps/plugin-opener', () => ({
    openUrl: vi.fn()
}));

afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
});

describe('external links', () => {
    it.each(['javascript:alert(1)', 'data:text/html,unsafe', 'file:///tmp/secret'])(
        'rejects unsupported protocol %s',
        (url) => {
            expect(() => normalizeExternalUrl(url)).toThrow('cannot be opened externally');
        }
    );

    it('opens browser links through a temporary noopener anchor', async () => {
        const originalCreateElement = document.createElement.bind(document);
        const anchor = originalCreateElement('a');
        anchor.click = vi.fn();
        vi.spyOn(document, 'createElement').mockImplementation((tagName: string) =>
            tagName === 'a' ? anchor : originalCreateElement(tagName)
        );

        await new WebExternalAdapter().openUrl('https://example.com/docs');

        expect(anchor.href).toBe('https://example.com/docs');
        expect(anchor.target).toBe('_blank');
        expect(anchor.rel).toBe('noopener noreferrer');
        expect(anchor.click).toHaveBeenCalledOnce();
        expect(anchor.isConnected).toBe(false);
    });

    it('delegates safe URLs to the Tauri opener plugin', async () => {
        vi.mocked(openUrl).mockResolvedValue(undefined);

        await new TauriExternalAdapter().openUrl('mailto:hello@example.com');

        expect(openUrl).toHaveBeenCalledWith('mailto:hello@example.com');
    });

    it('prepares safe rendered links and disables unsafe links', () => {
        const node = document.createElement('div');
        node.innerHTML = `
            <a data-safe href="https://example.com">Safe</a>
            <a data-fragment href="#section">Section</a>
            <a data-unsafe href="javascript:alert(1)">Unsafe</a>
        `;

        externalLinks(node, undefined);

        const safe = node.querySelector<HTMLAnchorElement>('[data-safe]');
        const fragment = node.querySelector<HTMLAnchorElement>('[data-fragment]');
        const unsafe = node.querySelector<HTMLAnchorElement>('[data-unsafe]');
        expect(safe?.target).toBe('_blank');
        expect(safe?.rel).toBe('noopener noreferrer');
        expect(fragment?.getAttribute('href')).toBe('#section');
        expect(fragment?.hasAttribute('target')).toBe(false);
        expect(unsafe?.hasAttribute('href')).toBe(false);
    });

    it('routes rendered link clicks through the platform adapter', () => {
        const open = vi.spyOn(appExternal, 'openUrl').mockResolvedValue(undefined);
        const node = document.createElement('div');
        node.innerHTML = '<a href="https://example.com"><span>Open</span></a>';
        const action = externalLinks(node, undefined);
        const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });

        node.querySelector('span')?.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(true);
        expect(open).toHaveBeenCalledWith('https://example.com');
        action?.destroy?.();
    });

    it('reports reusable link-opening failures through the shared toast', async () => {
        vi.spyOn(appExternal, 'openUrl').mockRejectedValue(new Error('blocked'));
        const showError = vi.spyOn(toast, 'error');

        await expect(openExternalLink('https://example.com')).resolves.toBe(false);

        expect(showError).toHaveBeenCalledWith({
            title: 'Could not open link',
            description: 'blocked'
        });
    });
});
