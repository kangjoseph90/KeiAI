import { render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import ParticipantCardMenu from '$lib/components/ParticipantCardMenu.svelte';

describe('ParticipantCardMenu', () => {
    it('keeps participant actions behind one named menu trigger', () => {
        render(ParticipantCardMenu, {
            kind: 'character',
            name: 'Ada',
            isDefault: true,
            onOpen: vi.fn(),
            onSetDefault: vi.fn(),
            onRemove: vi.fn()
        });

        expect(screen.getByLabelText('Ada is the default character')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Actions for Ada' })).toBeTruthy();
    });
});
