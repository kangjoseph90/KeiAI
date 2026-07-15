import { render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import KeyValueEditor from '$lib/components/KeyValueEditor.svelte';

describe('KeyValueEditor', () => {
    it('disables all editing controls when no writable snapshot exists', () => {
        render(KeyValueEditor, {
            disabled: true,
            data: { mood: 'calm' },
            onUpdateValue: vi.fn(),
            onAdd: vi.fn(),
            onRemove: vi.fn()
        });

        expect(
            screen.getByRole('textbox', { name: 'Value for mood' }).hasAttribute('disabled')
        ).toBe(true);
        expect(screen.getByRole('button', { name: 'Delete mood' }).hasAttribute('disabled')).toBe(
            true
        );
        expect(screen.getByRole('textbox', { name: 'New key name' }).hasAttribute('disabled')).toBe(
            true
        );
        expect(
            screen.getByRole('textbox', { name: 'New key value' }).hasAttribute('disabled')
        ).toBe(true);
        expect(screen.getByRole('button', { name: 'Add' }).hasAttribute('disabled')).toBe(true);
    });
});
