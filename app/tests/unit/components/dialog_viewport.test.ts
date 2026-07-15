import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import DialogViewportHarness from './dialog_viewport_harness.svelte';

describe('dialog viewport contract', () => {
    it('applies the bounded dialog surface by default', () => {
        render(DialogViewportHarness);

        const dialog = screen.getByRole('dialog', { name: 'Viewport test' });
        expect(dialog.classList.contains('app-dialog-content')).toBe(true);
        expect(screen.getByRole('button', { name: 'Close' }).classList.contains('size-9')).toBe(
            true
        );
    });

    it('opts fullscreen editors into the shared fullscreen boundary', () => {
        render(DialogViewportHarness, { fullscreen: true });

        const dialog = screen.getByRole('dialog', { name: 'Viewport test' });
        expect(dialog.classList.contains('app-dialog-content')).toBe(true);
        expect(dialog.classList.contains('app-dialog-fullscreen')).toBe(true);
    });
});
