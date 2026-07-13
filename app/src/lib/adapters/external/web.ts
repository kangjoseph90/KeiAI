import type { IExternalAdapter } from './types';
import { normalizeExternalUrl } from './types';

export class WebExternalAdapter implements IExternalAdapter {
    async openUrl(value: string): Promise<void> {
        const anchor = document.createElement('a');
        anchor.href = normalizeExternalUrl(value);
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        anchor.hidden = true;
        document.body.appendChild(anchor);

        try {
            anchor.click();
        } finally {
            anchor.remove();
        }
    }
}
