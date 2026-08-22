/**
 * Central animation-level policy. app.css keys its global rules off
 * html[data-animation-level]; JS-driven motion (Svelte transitions, typewriter
 * cadence, eased scrolling) runs through these helpers so components never
 * branch on the level themselves.
 */
import { get } from 'svelte/store';
import { flip as svelteFlip, type AnimationConfig, type FlipParams } from 'svelte/animate';
import {
    slide as svelteSlide,
    scale as svelteScale,
    type ScaleParams,
    type SlideParams,
    type TransitionConfig
} from 'svelte/transition';
import { animationLevel, prefersReducedMotion } from './state';
import type { AnimationLevel } from '$lib/services';

export type { AnimationLevel };

export function setPrefersReducedMotion(prefersReduced: boolean): void {
    prefersReducedMotion.set(prefersReduced);
}

export function applyAnimationLevel(root: { dataset: DOMStringMap }, level: AnimationLevel): void {
    root.dataset.animationLevel = level;
}

/** Whether JS-driven motion (typewriter cadence, eased scrolling) runs. */
export function motionEnabled(): boolean {
    return get(animationLevel) === 'full';
}

/** Zeroes explicit durations below 'full'; function durations pass through. */
function motionParams<P extends { duration?: number | ((...args: never[]) => number) }>(
    params: P
): P {
    if (get(animationLevel) !== 'full' && typeof params.duration === 'number') {
        return { ...params, duration: 0 };
    }
    return params;
}

export function slide(node: Element, params: SlideParams = {}): TransitionConfig {
    return svelteSlide(node, motionParams(params));
}

export function scale(node: Element, params: ScaleParams = {}): TransitionConfig {
    return svelteScale(node, motionParams(params));
}

export function flip(
    node: Element,
    move: { from: DOMRect; to: DOMRect },
    params: FlipParams = {}
): AnimationConfig {
    return svelteFlip(node, move, motionParams(params));
}
