/**
 * Global Configuration — KeiAI
 *
 * Centralized environment variables and system-wide constants.
 * These are used across the application, including Web Workers.
 */

/** Official KeiAI server URLs (hardcoded) */
export const KEI_PB_URL = 'https://api.keiai.xyz';
export const KEI_CDN_URL = 'https://cdn.keiai.xyz';

/** Proxy URL for bypassing CORS on the web */
export const PROXY_URL = import.meta.env.VITE_PROXY_URL ?? '';

/** PocketBase server URL */
export const PB_URL = import.meta.env.VITE_PB_URL ?? '';

/** Safe mode — disables pipes, events */
let safeMode = false;
export const isSafeMode = () => safeMode;
export const setSafeMode = (v: boolean) => {
    safeMode = v;
};

// Validation (Fail fast in non-worker context if required vars are missing)
if (typeof window !== 'undefined') {
    if (!PROXY_URL) {
        console.warn('VITE_PROXY_URL is not set. External API calls may fail due to CORS.');
    }
    if (!PB_URL) {
        console.error('VITE_PB_URL is not set. PocketBase connection will fail.');
    }
}
