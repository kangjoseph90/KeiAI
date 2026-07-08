/**
 * Ephemeral UI-only writable state.
 *
 * These stores are intentionally writable from components for shallow view state
 * such as dialog open bindings. Do not put persisted domain state, task state,
 * or service-owned state here.
 */

import { writable } from 'svelte/store';

export const characterPickerOpen = writable(false);
export const personaPickerOpen = writable(false);
