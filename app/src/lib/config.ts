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

export interface EnvironmentConfigIssue {
    title: string;
    message: string;
    missingVariables: string[];
}

interface EnvironmentConfig {
    pbUrl: string;
    proxyUrl: string;
}

export function getEnvironmentConfigIssue(
    config: EnvironmentConfig = { pbUrl: PB_URL, proxyUrl: PROXY_URL }
): EnvironmentConfigIssue | null {
    const missingVariables: string[] = [];
    if (!config.pbUrl.trim()) missingVariables.push('VITE_PB_URL');
    if (!config.proxyUrl.trim()) missingVariables.push('VITE_PROXY_URL');

    if (missingVariables.length === 0) return null;

    return {
        title: 'Environment configuration required',
        message: `Set ${missingVariables.join(' and ')} before starting KeiAI.`,
        missingVariables
    };
}

/** Safe mode — disables pipes, events */
let safeMode = false;
export const isSafeMode = () => safeMode;
export const setSafeMode = (v: boolean) => {
    safeMode = v;
};
