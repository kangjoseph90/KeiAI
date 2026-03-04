export * from './types.js';

// For now, Tauri also uses the Web (Dexie) user adapter to safely store CryptoKey objects.
// When tauri-plugin-stronghold is implemented, TauriUserAdapter will wrap WebUserAdapter
// to provide the backupGuestKey/restoreGuestKey functionality.

import { WebUserAdapter } from './web.js';
// import { TauriUserAdapter } from './tauri.js'; // To be implemented later with Stronghold

// export const appUser = isTauri() ? new TauriUserAdapter() : new WebUserAdapter();
export const appUser = new WebUserAdapter();
