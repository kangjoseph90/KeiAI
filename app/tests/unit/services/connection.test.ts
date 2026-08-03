import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '$lib/services/user';

const appHttpMock = vi.hoisted(() => ({
    fetch: vi.fn(),
    configureProxy: vi.fn(),
    getProxyConfig: vi.fn(() => ({ mode: 'direct' as const }))
}));
const pbMock = vi.hoisted(() => ({
    baseUrl: 'https://default.example.test',
    cancelRequest: vi.fn(),
    authStore: { clear: vi.fn() }
}));
const userServiceMock = vi.hoisted(() => ({
    getUser: vi.fn(),
    updateConnections: vi.fn()
}));
const assetServiceMock = vi.hoisted(() => ({
    getRemoteAssets: vi.fn(),
    load: vi.fn(),
    markLocalBatch: vi.fn(),
    markRemoteBatch: vi.fn(),
    stopEviction: vi.fn(),
    resumeEviction: vi.fn()
}));

vi.mock('$lib/config', () => ({
    PB_URL: 'https://default.example.test',
    PROXY_URL: 'https://proxy.example.test',
    KEI_PB_URL: 'https://api.keiai.xyz',
    KEI_PROXY_URL: 'https://proxy.keiai.xyz'
}));
vi.mock('$lib/adapters/http', () => ({ appHttp: appHttpMock }));
vi.mock('$lib/adapters/pb', () => ({ pb: pbMock }));
vi.mock('$lib/services/user', () => ({ UserService: userServiceMock }));
vi.mock('$lib/services/asset', () => ({ AssetService: assetServiceMock }));
vi.mock('$lib/services/session', () => ({
    getActiveSession: () => ({ userId: 'user-1' })
}));
vi.mock('$lib/services/sync', () => ({
    SyncManager: { stopAutoSync: vi.fn(), startAutoSync: vi.fn() }
}));

import { ConnectionService } from '$lib/services/connection/service';

const baseUser: User = {
    id: 'user-1',
    name: 'User',
    avatar: '',
    connections: {
        server: { mode: 'default' },
        proxy: { mode: 'default' }
    }
};

describe('ConnectionService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        pbMock.baseUrl = 'https://default.example.test';
        userServiceMock.getUser.mockResolvedValue(baseUser);
        userServiceMock.updateConnections.mockImplementation(
            async (_userId: string, connections: User['connections']) => ({
                ...baseUser,
                connections
            })
        );
        assetServiceMock.getRemoteAssets.mockResolvedValue([]);
        appHttpMock.fetch.mockResolvedValue(
            new Response(
                JSON.stringify({
                    app: 'keiai-proxy',
                    protocol: 1
                }),
                { status: 200 }
            )
        );
    });

    it('validates and applies a custom proxy before exposing the updated user', async () => {
        const updated = await ConnectionService.changeProxyConnection({
            mode: 'custom',
            customUrl: 'https://custom-proxy.example.test/'
        });

        expect(appHttpMock.fetch).toHaveBeenCalledWith(
            'https://custom-proxy.example.test/spec',
            { method: 'GET' },
            expect.any(Object)
        );
        expect(userServiceMock.updateConnections).toHaveBeenCalledWith(
            'user-1',
            expect.objectContaining({
                proxy: {
                    mode: 'custom',
                    customUrl: 'https://custom-proxy.example.test'
                }
            })
        );
        expect(appHttpMock.configureProxy).toHaveBeenCalledWith({
            mode: 'proxy',
            baseUrl: 'https://custom-proxy.example.test'
        });
        expect(updated.connections.proxy.mode).toBe('custom');
    });

    it('localizes assets before committing a different server', async () => {
        const remoteAsset = { id: 'asset-1' };
        assetServiceMock.getRemoteAssets.mockResolvedValue([remoteAsset]);
        assetServiceMock.load.mockResolvedValue(true);
        appHttpMock.fetch.mockResolvedValue(
            new Response(JSON.stringify({ app: 'keiai', protocol: 1 }), { status: 200 })
        );

        await ConnectionService.changeServerConnection({
            mode: 'custom',
            customUrl: 'https://custom-server.example.test/'
        });

        expect(assetServiceMock.load).toHaveBeenCalledWith(remoteAsset);
        expect(assetServiceMock.markLocalBatch).toHaveBeenCalledWith([remoteAsset]);
        expect(pbMock.baseUrl).toBe('https://custom-server.example.test');
        expect(pbMock.authStore.clear).toHaveBeenCalledOnce();
    });

    it('restores remote asset state when the server commit fails', async () => {
        const remoteAsset = { id: 'asset-1' };
        assetServiceMock.getRemoteAssets.mockResolvedValue([remoteAsset]);
        assetServiceMock.load.mockResolvedValue(true);
        appHttpMock.fetch.mockResolvedValue(
            new Response(JSON.stringify({ app: 'keiai', protocol: 1 }), { status: 200 })
        );
        userServiceMock.updateConnections.mockRejectedValueOnce(new Error('save failed'));

        await expect(
            ConnectionService.changeServerConnection({
                mode: 'custom',
                customUrl: 'https://custom-server.example.test'
            })
        ).rejects.toThrow('save failed');

        expect(assetServiceMock.markRemoteBatch).toHaveBeenCalledWith([remoteAsset]);
        expect(pbMock.baseUrl).toBe('https://default.example.test');
    });
});
