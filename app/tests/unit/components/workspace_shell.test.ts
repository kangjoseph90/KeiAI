import { createRawSnippet } from 'svelte';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { Settings, User } from 'lucide-svelte';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceShell } from '$lib/components/layout';

describe('WorkspaceShell', () => {
    it('renders route-owned detail state and delegates navigation', async () => {
        const onSelect = vi.fn();
        const onBack = vi.fn();
        const children = createRawSnippet(() => ({ render: () => '<p>Detail content</p>' }));

        const { container } = render(WorkspaceShell, {
            workspaceName: 'Settings',
            sections: [
                { id: 'profile', label: 'Profile', icon: User },
                { id: 'general', label: 'General', icon: Settings }
            ] as const,
            activeSection: 'profile',
            showDetail: true,
            onSelect,
            onBack,
            onClose: vi.fn(),
            closeLabel: 'Close settings',
            children
        });

        expect(
            screen
                .getByRole('navigation', { name: 'Settings sections' })
                .classList.contains('hidden')
        ).toBe(true);
        expect(container.querySelector('main')?.classList.contains('flex')).toBe(true);
        expect(screen.getByRole('heading', { name: 'Profile' })).toBeTruthy();
        expect(screen.getByText('Detail content')).toBeTruthy();

        await fireEvent.click(screen.getByRole('button', { name: 'General' }));
        expect(onSelect).toHaveBeenCalledWith('general');

        await fireEvent.click(screen.getByRole('button', { name: 'Back to Settings sections' }));
        expect(onBack).toHaveBeenCalledOnce();
    });
});
