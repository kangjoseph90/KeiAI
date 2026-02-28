/**
 * Lorebook Store — Owned Resources
 *
 * Lorebooks are 1:N owned children (via ownerId FK).
 * They are NOT global — always belong to a character, chat, or module.
 *
 * CRUD is handled by parent stores (character.ts, chat.ts, module.ts).
 * This file only re-exports the editing context store.
 */
export { activeLorebooks } from './state.js';
