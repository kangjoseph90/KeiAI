import { appHttp, type ProxyRuntimeConfig } from '$lib/adapters/http';
import { pb } from '$lib/adapters/pb';
import { KEI_PB_URL, KEI_PROXY_URL, PB_URL, PROXY_URL } from '$lib/config';
import type {
    ProxyConnectionSettings,
    ServerConnectionSettings,
    UserConnectionSettings
} from '$lib/types/connections';
import { normalizeUrl } from '$lib/utils/url';

function requireCustomUrl(url: string | undefined, label: string): string {
    const normalized = normalizeUrl(url?.trim() ?? '');
    if (!normalized) throw new Error(`${label} URL is not configured.`);
    return normalized;
}

export function resolveServerUrl(settings: ServerConnectionSettings): string {
    if (settings.mode === 'custom') {
        return requireCustomUrl(settings.customUrl, 'Custom server');
    }

    const normalized = normalizeUrl(PB_URL.trim());
    if (!normalized) throw new Error('Default server URL is not configured.');
    return normalized;
}

export function resolveProxyRuntimeConfig(settings: ProxyConnectionSettings): ProxyRuntimeConfig {
    if (settings.mode === 'off') return { mode: 'direct' };

    if (settings.mode === 'custom') {
        return { mode: 'proxy', baseUrl: requireCustomUrl(settings.customUrl, 'Custom proxy') };
    }

    const normalized = normalizeUrl(PROXY_URL.trim());
    return normalized ? { mode: 'proxy', baseUrl: normalized } : { mode: 'direct' };
}

export function applyUserConnectionRuntime(settings: UserConnectionSettings): void {
    pb.baseUrl = resolveServerUrl(settings.server);
    appHttp.configureProxy(resolveProxyRuntimeConfig(settings.proxy));
}

export function resetConnectionRuntime(): void {
    pb.baseUrl = normalizeUrl(PB_URL.trim());
    appHttp.configureProxy(
        PROXY_URL.trim()
            ? { mode: 'proxy', baseUrl: normalizeUrl(PROXY_URL.trim()) }
            : { mode: 'direct' }
    );
}

export function isKeiServer(): boolean {
    return normalizeUrl(pb.baseUrl) === normalizeUrl(KEI_PB_URL);
}

export function isKeiProxy(): boolean {
    const config = appHttp.getProxyConfig();
    return config.mode === 'proxy' && normalizeUrl(config.baseUrl) === normalizeUrl(KEI_PROXY_URL);
}
