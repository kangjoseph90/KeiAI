/**
 * Global Configuration — KeiAI
 *
 * Centralized environment variables and system-wide constants.
 * These are used across the application, including Web Workers.
 */

/** CDN base URL for asset and resource delivery */
export const CDN_BASE_URL = import.meta.env.VITE_CDN_BASE_URL ?? '';

/** Fixed salt for deterministic key derivation (E2EE) */
export const FIXED_SALT = import.meta.env.VITE_FIXED_SALT ?? '';

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
    if (!CDN_BASE_URL) {
        console.warn('VITE_CDN_BASE_URL is not set. Local static assets will be used.');
    }
    if (!FIXED_SALT) {
        console.error('VITE_FIXED_SALT is not set. E2EE operations will fail.');
    }
    if (!PROXY_URL) {
        console.warn('VITE_PROXY_URL is not set. External API calls may fail due to CORS.');
    }
    if (!PB_URL) {
        console.error('VITE_PB_URL is not set. PocketBase connection will fail.');
    }
}
