/**
 * Script Store — Owned Resources
 *
 * Scripts are 1:N owned children (via ownerId FK).
 * They belong to a character or module (NOT chat).
 * 
 * CRUD is handled by parent stores (character.ts, module.ts).
 * This file only re-exports the editing context store.
 */
export { activeScripts } from './state.js';
