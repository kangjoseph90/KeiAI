import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import AutoResizeTextarea from '$lib/components/AutoResizeTextarea.svelte';

function setTextareaMetrics(
    textarea: HTMLTextAreaElement,
    metrics: { scrollHeight: number; offsetHeight: number; clientHeight: number }
): void {
    for (const [name, value] of Object.entries(metrics)) {
        Object.defineProperty(textarea, name, { configurable: true, value });
    }
}

describe('AutoResizeTextarea', () => {
    it('only enables vertical scrolling after reaching its maximum height', async () => {
        render(AutoResizeTextarea, { maxHeight: 100 });
        const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;

        setTextareaMetrics(textarea, { scrollHeight: 40, offsetHeight: 42, clientHeight: 40 });
        await fireEvent.input(textarea);

        expect(textarea.style.height).toBe('42px');
        expect(textarea.style.overflowY).toBe('hidden');

        setTextareaMetrics(textarea, { scrollHeight: 120, offsetHeight: 42, clientHeight: 40 });
        await fireEvent.input(textarea);

        expect(textarea.style.height).toBe('100px');
        expect(textarea.style.overflowY).toBe('auto');
    });
});
