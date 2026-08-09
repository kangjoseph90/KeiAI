// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import TypewriterText from '../../../src/lib/components/TypewriterText.svelte';

describe('TypewriterText', () => {
    let target: HTMLDivElement;

    beforeEach(() => {
        vi.useFakeTimers();
        target = document.createElement('div');
        document.body.appendChild(target);
    });

    afterEach(() => {
        target.remove();
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('renders initial text immediately without typing animation', () => {
        const app = mount(TypewriterText, {
            target,
            props: { text: 'Initial Title' }
        });
        flushSync();

        expect(target.textContent).toContain('Initial Title');
        unmount(app);
    });

    it('animates typing when text prop changes', () => {
        let text = $state('Old Title');
        const app = mount(TypewriterText, {
            target,
            get props() {
                return { text, speed: 20 };
            }
        });
        flushSync();

        expect(target.textContent).toContain('Old Title');

        text = 'New Title';
        flushSync();

        vi.advanceTimersByTime(50);
        flushSync();

        vi.advanceTimersByTime(500);
        flushSync();

        expect(target.textContent).toContain('New Title');
        unmount(app);
    });
});
