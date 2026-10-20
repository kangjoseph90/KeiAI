import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Dexie from 'dexie';
import { appAsset } from '$lib/adapters/asset';
import { localDB, type DataRecord } from '$lib/adapters/db';
import { pb } from '$lib/adapters/pb';
import { AssetService } from '$lib/services/asset';
import { encryptConvergentAsset } from '$lib/services/asset/util';
import { fetchAssetCiphertext } from '$lib/services/asset/remote';
import { ConnectionService } from '$lib/services/connection/service';

const state = vi.hoisted(() => ({
    bytes: new Map<string, Uint8Array>(),
    connections: {
        server: { mode: 'custom' as const, customUrl: 'https://old.example.test' },
        proxy: { mode: 'off' as const }
    }
}));

vi.mock('$lib/adapters/storage', () => ({
    appStorage: {
        write: async (path: string, bytes: Uint8Array) => {
            state.bytes.set(path, bytes);
        },
        read: async (path: string) => state.bytes.get(path) ?? null,
        exists: async (path: string) => state.bytes.has(path),
        delete: async (path: string) => {
            state.bytes.delete(path);
        }
    }
}));
vi.mock('$lib/adapters/http', () => ({
    appHttp: {
        fetch: async () => new Response(JSON.stringify({ app: 'keiai', protocol: 1 })),
        configureProxy: vi.fn()
    }
}));
vi.mock('$lib/services/user', () => ({
    UserService: {
        getUser: async () => ({ id: 'audituser000001', connections: state.connections }),
        updateConnections: async (_id: string, connections: typeof state.connections) => {
            state.connections = connections;
            return { id: 'audituser000001', connections };
        }
    }
}));
vi.mock('$lib/services/session', () => ({
    getActiveSession: () => ({ userId: 'audituser000001' }),
    canAccessScope: () => true
}));
vi.mock('$lib/services/auth', () => ({
    AuthService: {
        persistPbAuth: vi.fn(),
        restorePbAuth: vi.fn(),
        stopAutoRefresh: vi.fn(),
        startAutoRefresh: vi.fn()
    }
}));
vi.mock('$lib/services/sync', () => ({
    SyncManager: { stopAutoSync: vi.fn(), startAutoSync: vi.fn() }
}));
vi.mock('$lib/services/asset/remote', () => ({ fetchAssetCiphertext: vi.fn() }));

describe('server asset localization', () => {
    beforeEach(async () => {
        await Dexie.delete('KeiLocalDB');
        await Dexie.delete('KeiAssets');
        state.bytes.clear();
        state.connections.server.customUrl = 'https://old.example.test';
        pb.baseUrl = 'https://old.example.test';
        AssetService.stopEviction();
    });

    afterEach(async () => {
        AssetService.stopEviction();
        vi.restoreAllMocks();
        await Dexie.delete('KeiLocalDB');
        await Dexie.delete('KeiAssets');
    });

    it.each(['missing key', 'missing bytes'])(
        'keeps the old server when a referenced asset has %s',
        async (failure) => {
            const hash = 'a'.repeat(64);
            const parent: DataRecord = {
                id: 'assetowner00001',
                scopeType: 'user',
                scopeId: 'audituser000001',
                createdAt: 1,
                updatedAt: 1,
                isDeleted: false,
                assetEntries: { [hash]: 'remote' },
                data: failure === 'missing key' ? {} : { avatar: { hash, encKey: 'key' } }
            };
            await localDB.putRecord('characters', parent);
            vi.mocked(fetchAssetCiphertext).mockResolvedValue(null);

            await expect(
                ConnectionService.changeServerConnection({
                    mode: 'custom',
                    customUrl: 'https://new.example.test'
                })
            ).rejects.toThrow(
                failure === 'missing key' ? 'Missing encryption key' : 'could not be localized'
            );

            expect(pb.baseUrl).toBe('https://old.example.test');
            expect((await localDB.getRecord('characters', parent.id))!.assetEntries).toEqual({
                [hash]: 'remote'
            });
        }
    );

    it.each(['never cached', 'evicted'] as const)(
        'localizes a remote asset that was %s before switching servers',
        async (cacheHistory) => {
            const bytes = new Uint8Array([1, 2, 3, 4]);
            const encrypted = await encryptConvergentAsset(bytes);
            const locator = {
                scopeType: 'user' as const,
                scopeId: 'audituser000001',
                ownerTable: 'characters' as const,
                ownerId: 'assetowner00001',
                hash: encrypted.hash,
                encKey: encrypted.encKey
            };
            const parent: DataRecord = {
                id: locator.ownerId,
                scopeType: locator.scopeType,
                scopeId: locator.scopeId,
                createdAt: 1,
                updatedAt: 1,
                isDeleted: false,
                assetEntries: { [locator.hash]: 'remote' },
                data: {
                    avatar: {
                        name: 'attachment.txt',
                        hash: locator.hash,
                        encKey: locator.encKey,
                        mimeType: 'text/plain'
                    }
                }
            };
            await localDB.putRecord('characters', parent);
            // A real old-server ciphertext is available if localization asks for it.
            vi.mocked(fetchAssetCiphertext).mockImplementation(async () =>
                pb.baseUrl === 'https://old.example.test' ? encrypted.ciphertext : null
            );
            if (cacheHistory === 'evicted') {
                await appAsset.putRemoteAsset({ ...locator, bytes });
                await appAsset.deleteAsset(locator); // The operation used by evictCache.
            } else {
                // Record sync calls markRemote; it does not create a missing cache row.
                await AssetService.markRemote(locator);
            }
            expect(await appAsset.getAsset(locator)).toBeUndefined();
            expect(
                await AssetService.getRemoteAssets({ scopeType: 'user', scopeId: locator.scopeId })
            ).toEqual([locator]);
            const load = vi.spyOn(AssetService, 'load');

            await ConnectionService.changeServerConnection({
                mode: 'custom',
                customUrl: 'https://new.example.test'
            });

            expect(pb.baseUrl).toBe('https://new.example.test');
            expect(load).toHaveBeenCalledWith(locator);
            expect(fetchAssetCiphertext).toHaveBeenCalledOnce();
            expect(await appAsset.readAssetBytes(locator)).toEqual(bytes);
            expect((await localDB.getRecord('characters', parent.id))!.assetEntries).toEqual({
                [locator.hash]: 'local'
            });
            expect((await appAsset.getAsset(locator))!.status).toBe('local');
        }
    );
});
