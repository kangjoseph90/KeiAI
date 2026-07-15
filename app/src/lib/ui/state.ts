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

export type ModalVariant = 'default' | 'destructive';

export type ModalRequest =
    | {
          id: string;
          type: 'alert';
          title: string;
          description?: string;
          confirmText: string;
          resolve: () => void;
      }
    | {
          id: string;
          type: 'confirm';
          title: string;
          description?: string;
          confirmText: string;
          cancelText: string;
          variant: ModalVariant;
          resolve: (confirmed: boolean) => void;
      }
    | {
          id: string;
          type: 'prompt';
          title: string;
          description?: string;
          confirmText: string;
          cancelText: string;
          defaultValue: string;
          placeholder?: string;
          resolve: (value: string | null) => void;
      };

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface ToastAction {
    label: string;
    run: () => void | Promise<void>;
}

export interface ToastItem {
    id: string;
    kind: ToastKind;
    title: string;
    description?: string;
    action?: ToastAction;
    persistent: boolean;
}

export const modalQueue = writable<ModalRequest[]>([]);
export const toastItems = writable<ToastItem[]>([]);
