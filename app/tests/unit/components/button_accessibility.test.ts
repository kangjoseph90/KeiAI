import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { Button } from '$lib/components/ui/button';

describe('Button', () => {
    it('exposes its size so coarse-pointer styles can enlarge icon targets', () => {
        render(Button, { size: 'icon-sm', 'aria-label': 'Open actions' });

        expect(screen.getByRole('button', { name: 'Open actions' }).getAttribute('data-size')).toBe(
            'icon-sm'
        );
    });
});
