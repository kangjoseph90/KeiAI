/**
 * Global Configuration — KeiAI
 *
 * Centralized environment variables and system-wide constants.
 * These are used across the application, including Web Workers.
 */

import { normalizeUrl } from './utils/url';

/** Official KeiAI server URLs (hardcoded) */
export const KEI_PB_URL = 'https://api.keiai.xyz';
export const KEI_CDN_URL = 'https://cdn.keiai.xyz';
export const KEI_PROXY_URL = 'https://proxy.keiai.xyz';

/** Proxy URL for bypassing CORS on the web */
export const PROXY_URL = import.meta.env.VITE_PROXY_URL ?? '';

/** PocketBase server URL */
export const PB_URL = import.meta.env.VITE_PB_URL ?? '';

export function isKeiDefaultServer(): boolean {
    return normalizeUrl(PB_URL) === normalizeUrl(KEI_PB_URL);
}

export function isKeiDefaultProxy(): boolean {
    return normalizeUrl(PROXY_URL) === normalizeUrl(KEI_PROXY_URL);
}

export interface EnvironmentConfigIssue {
    title: string;
    message: string;
    missingVariables: string[];
}

interface EnvironmentConfig {
    pbUrl: string;
}

export function getEnvironmentConfigIssue(
    config: EnvironmentConfig = { pbUrl: PB_URL }
): EnvironmentConfigIssue | null {
    const missingVariables: string[] = [];
    if (!config.pbUrl.trim()) missingVariables.push('VITE_PB_URL');

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
