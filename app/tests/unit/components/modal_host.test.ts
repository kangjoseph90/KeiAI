import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import ModalHost from '$lib/components/app/ModalHost.svelte';
import { appAlert, appConfirm } from '$lib/ui';
import { modalQueue } from '$lib/ui/state';

describe('ModalHost', () => {
    afterEach(() => modalQueue.set([]));

    it('places cancel and confirm actions side by side on compact screens', async () => {
        render(ModalHost);
        const result = appConfirm({ title: 'Delete room?', confirmText: 'Delete' });

        const footer = await screen.findByText('Delete').then((button) => button.parentElement);
        expect(footer?.classList.contains('grid')).toBe(true);
        expect(footer?.classList.contains('grid-cols-2')).toBe(true);

        await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        await expect(result).resolves.toBe(false);
    });

    it('keeps single-action alerts out of the two-column layout', async () => {
        render(ModalHost);
        const result = appAlert({ title: 'Notice' });

        const footer = await screen.findByText('OK').then((button) => button.parentElement);
        expect(footer?.classList.contains('grid-cols-2')).toBe(false);

        await fireEvent.click(screen.getByRole('button', { name: 'OK' }));
        await expect(result).resolves.toBeUndefined();
    });
});
