/**
 * Animation Level Store Tests
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { animationLevel, appSettings, prefersReducedMotion } from '$lib/stores/state';
import {
    applyAnimationLevel,
    motionEnabled,
    scale,
    setPrefersReducedMotion,
    slide
} from '$lib/stores/animation';
import { makeSettings } from '../../utils';

function setLevel(level: 'full' | 'minimal' | 'none'): void {
    appSettings.set(makeSettings({ ui: { animationLevel: level } }));
}

describe('animation level', () => {
    beforeEach(() => {
        appSettings.set(null);
        prefersReducedMotion.set(false);
    });

    it('defaults to full before settings load', () => {
        expect(get(animationLevel)).toBe('full');
    });

    it('reflects the persisted setting', () => {
        setLevel('minimal');
        expect(get(animationLevel)).toBe('minimal');
    });

    it('escalates to none when the OS prefers reduced motion', () => {
        setLevel('full');
        setPrefersReducedMotion(true);
        expect(get(animationLevel)).toBe('none');

        setLevel('minimal');
        expect(get(animationLevel)).toBe('none');
    });

    it('mirrors the level onto the document root', () => {
        const root = { dataset: {} as DOMStringMap };
        applyAnimationLevel(root, 'minimal');
        expect(root.dataset.animationLevel).toBe('minimal');
    });

    it('keeps explicit transition durations at full and collapses them below', () => {
        const node = document.createElement('div');

        setLevel('full');
        expect(motionEnabled()).toBe(true);
        expect(slide(node, { duration: 150 }).duration).toBe(150);
        expect(scale(node, { duration: 150 }).duration).toBe(150);

        setLevel('minimal');
        expect(motionEnabled()).toBe(false);
        expect(slide(node, { duration: 150 }).duration).toBe(0);
        expect(scale(node, { duration: 150 }).duration).toBe(0);

        setLevel('none');
        expect(slide(node, { duration: 150 }).duration).toBe(0);
    });
});
