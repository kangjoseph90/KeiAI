/**
 * Sync Manager Tests
 *
 * Tests the SyncManager record sync and binary worker lifecycle.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SyncManager } from '$lib/services/sync';
import { DataRecordSyncEngine } from '$lib/services/sync/data';
import { UserRecordSyncEngine } from '$lib/services/sync/user';
import { AssetSyncEngine } from '$lib/services/sync/asset';
import { MultiRecordSyncEngine } from '$lib/services/sync/multi';
import { appUser } from '$lib/adapters/user';
import { appMulti } from '$lib/adapters/multi';
import { localDB } from '$lib/adapters/db';
import type { DatabaseWriteEventListener } from '$lib/adapters/db';
import type { UserWriteEventListener } from '$lib/adapters/user';
import type { MultiWriteEventListener } from '$lib/adapters/multi';

let dbWriteListener: DatabaseWriteEventListener | null = null;
let userWriteListener: UserWriteEventListener | null = null;
let multiWriteListener: MultiWriteEventListener | null = null;

// Mock dependencies with stateful spies
vi.mock('$lib/services/sync/data', () => {
    let subscribed = false;
    const engine = {
        subscribeRealtime: vi.fn(async () => {
            subscribed = true;
        }),
        unsubscribeRealtime: vi.fn(async () => {
            subscribed = false;
        }),
        trigger: vi.fn(async () => {}),
        handleLocalWrite: vi.fn(),
        stop: vi.fn(),
        get isSubscribed() {
            return subscribed;
        },
        set isSubscribed(v: boolean) {
            subscribed = v;
        }
    };
    return {
        DataRecordSyncEngine: engine
    };
});

vi.mock('$lib/adapters/db', () => ({
    SYNC_TABLES: ['characters', 'chats'],
    TABLES: ['characters', 'chats'],
    localDB: {
        subscribeWriteEvents: vi.fn((listener: DatabaseWriteEventListener) => {
            dbWriteListener = listener;
            return () => {
                dbWriteListener = null;
            };
        })
    }
}));

vi.mock('$lib/adapters/user', () => ({
    appUser: {
        subscribeWriteEvents: vi.fn((listener: UserWriteEventListener) => {
            userWriteListener = listener;
            return () => {
                userWriteListener = null;
            };
        })
    }
}));

vi.mock('$lib/adapters/multi', () => ({
    appMulti: {
        subscribeWriteEvents: vi.fn((listener: MultiWriteEventListener) => {
            multiWriteListener = listener;
            return () => {
                multiWriteListener = null;
            };
        })
    }
}));

vi.mock('$lib/services/sync/user', () => {
    const engine = {
        subscribeRealtime: vi.fn(async () => {}),
        unsubscribeRealtime: vi.fn(async () => {}),
        trigger: vi.fn(async () => {}),
        handleLocalWrite: vi.fn(),
        stop: vi.fn(),
        isSubscribed: false
    };
    return {
        UserRecordSyncEngine: engine
    };
});

vi.mock('$lib/services/sync/asset', () => {
    const engine = {
        start: vi.fn(async () => {}),
        stop: vi.fn(),
        getState: vi.fn(() => ({ state: 'idle' })),
        subscribeStatus: vi.fn(() => () => {})
    };
    return {
        AssetSyncEngine: engine
    };
});

vi.mock('$lib/services/sync/multi', () => {
    let subscribed = false;
    const engine = {
        trigger: vi.fn(async () => {}),
        subscribeRealtime: vi.fn(async () => {
            subscribed = true;
        }),
        unsubscribeRealtime: vi.fn(async () => {
            subscribed = false;
        }),
        handleLocalWrite: vi.fn(),
        stop: vi.fn(),
        get isSubscribed() {
            return subscribed;
        },
        set isSubscribed(v: boolean) {
            subscribed = v;
        }
    };
    return {
        MultiRecordSyncEngine: engine
    };
});

describe('SyncManager', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();

        vi.spyOn(window, 'addEventListener').mockImplementation(() => {});
        vi.spyOn(window, 'removeEventListener').mockImplementation(() => {});
        vi.spyOn(document, 'addEventListener').mockImplementation(() => {});
        vi.spyOn(document, 'removeEventListener').mockImplementation(() => {});

        Object.defineProperty(document, 'visibilityState', {
            value: 'visible',
            configurable: true
        });

        // Reset internal static state
        SyncManager.stopAutoSync();
        vi.mocked(DataRecordSyncEngine.subscribeRealtime).mockClear();
        vi.mocked(UserRecordSyncEngine.subscribeRealtime).mockClear();
        vi.mocked(UserRecordSyncEngine.unsubscribeRealtime).mockClear();
        vi.mocked(UserRecordSyncEngine.trigger).mockClear();
        vi.mocked(UserRecordSyncEngine.handleLocalWrite).mockClear();
        vi.mocked(AssetSyncEngine.start).mockClear();
        vi.mocked(AssetSyncEngine.stop).mockClear();
        vi.mocked(MultiRecordSyncEngine.trigger).mockClear();
        vi.mocked(MultiRecordSyncEngine.subscribeRealtime).mockClear();
        vi.mocked(MultiRecordSyncEngine.unsubscribeRealtime).mockClear();
        vi.mocked(MultiRecordSyncEngine.handleLocalWrite).mockClear();
        (MultiRecordSyncEngine as unknown as { isSubscribed: boolean }).isSubscribed = false;
        vi.mocked(DataRecordSyncEngine.handleLocalWrite).mockClear();
        (DataRecordSyncEngine as unknown as { isSubscribed: boolean }).isSubscribed = false;
        dbWriteListener = null;
        userWriteListener = null;
        multiWriteListener = null;
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    describe('startAutoSync', () => {
        it('should start subscriptions and set poll timer', () => {
            SyncManager.startAutoSync();

            expect(DataRecordSyncEngine.subscribeRealtime).toHaveBeenCalled();
            expect(MultiRecordSyncEngine.subscribeRealtime).toHaveBeenCalled();
            expect(UserRecordSyncEngine.subscribeRealtime).toHaveBeenCalled();
            expect(AssetSyncEngine.start).toHaveBeenCalledTimes(1);
            expect(MultiRecordSyncEngine.trigger).not.toHaveBeenCalled();

            expect(DataRecordSyncEngine.trigger).not.toHaveBeenCalled();
            vi.advanceTimersByTime(300_000);
            expect(DataRecordSyncEngine.trigger).toHaveBeenCalledTimes(1);
            expect(AssetSyncEngine.start).toHaveBeenCalledTimes(2);
            expect(MultiRecordSyncEngine.trigger).toHaveBeenCalledTimes(1);

            expect(window.addEventListener).toHaveBeenCalledWith('online', expect.any(Function));
            expect(document.addEventListener).toHaveBeenCalledWith(
                'visibilitychange',
                expect.any(Function)
            );
        });

        it('should not start multiple times', () => {
            SyncManager.startAutoSync();
            SyncManager.startAutoSync();
            expect(DataRecordSyncEngine.subscribeRealtime).toHaveBeenCalledTimes(1);
            expect(localDB.subscribeWriteEvents).toHaveBeenCalledTimes(1);
            expect(appUser.subscribeWriteEvents).toHaveBeenCalledTimes(1);
            expect(appMulti.subscribeWriteEvents).toHaveBeenCalledTimes(1);
        });
    });

    describe('stopAutoSync', () => {
        it('should clear subscriptions and poll timer', () => {
            SyncManager.startAutoSync();
            SyncManager.stopAutoSync();

            expect(DataRecordSyncEngine.unsubscribeRealtime).toHaveBeenCalled();
            expect(MultiRecordSyncEngine.unsubscribeRealtime).toHaveBeenCalled();
            expect(UserRecordSyncEngine.unsubscribeRealtime).toHaveBeenCalled();
            expect(DataRecordSyncEngine.stop).toHaveBeenCalled();
            expect(MultiRecordSyncEngine.stop).toHaveBeenCalled();
            expect(UserRecordSyncEngine.stop).toHaveBeenCalled();
            expect(AssetSyncEngine.stop).toHaveBeenCalled();

            vi.advanceTimersByTime(300_000);
            expect(DataRecordSyncEngine.trigger).not.toHaveBeenCalled();
        });
    });

    describe('refreshRoomSync', () => {
        it('should resubscribe room-aware sync engines when auto sync is active', async () => {
            SyncManager.startAutoSync();
            vi.mocked(DataRecordSyncEngine.unsubscribeRealtime).mockClear();
            vi.mocked(DataRecordSyncEngine.subscribeRealtime).mockClear();
            vi.mocked(DataRecordSyncEngine.trigger).mockClear();
            vi.mocked(AssetSyncEngine.start).mockClear();

            await SyncManager.refreshRoomSync();

            expect(DataRecordSyncEngine.unsubscribeRealtime).toHaveBeenCalled();
            expect(DataRecordSyncEngine.subscribeRealtime).toHaveBeenCalled();
            expect(DataRecordSyncEngine.trigger).toHaveBeenCalled();
            expect(AssetSyncEngine.start).toHaveBeenCalled();
        });
    });

    describe('event listeners', () => {
        it('should trigger resubscribe on "online" event if offline', async () => {
            SyncManager.startAutoSync();

            // Find the online listener
            const onlineCall = vi
                .mocked(window.addEventListener)
                .mock.calls.find((c) => c[0] === 'online');
            const onlineHandler = onlineCall?.[1] as () => void;
            expect(onlineHandler).toBeDefined();

            // Force it to look disconnected
            (DataRecordSyncEngine as unknown as { isSubscribed: boolean }).isSubscribed = false;
            (MultiRecordSyncEngine as unknown as { isSubscribed: boolean }).isSubscribed = false;

            await onlineHandler();
            // We need to wait for the internal async chain
            await Promise.resolve(); // resubscribeAndPull
            await Promise.resolve(); // sub 1
            await Promise.resolve(); // sub 2
            await Promise.resolve(); // sub 3
            await Promise.resolve(); // sub 4
            await Promise.resolve(); // syncAll
            await Promise.resolve(); // user sync
            await Promise.resolve(); // final callback

            expect(DataRecordSyncEngine.subscribeRealtime).toHaveBeenCalledTimes(2); // once at start, once at online
            expect(MultiRecordSyncEngine.subscribeRealtime).toHaveBeenCalledTimes(2); // once at start, once at online
            expect(DataRecordSyncEngine.trigger).toHaveBeenCalled();
            expect(AssetSyncEngine.start).toHaveBeenCalledTimes(2);
            expect(MultiRecordSyncEngine.trigger).toHaveBeenCalledTimes(1);
            expect(UserRecordSyncEngine.trigger).toHaveBeenCalled();
        });

        it('should do nothing on "visibilitychange" if all record sync engines are subscribed', async () => {
            SyncManager.startAutoSync();

            const visCall = vi
                .mocked(document.addEventListener)
                .mock.calls.find((c) => c[0] === 'visibilitychange');
            const visHandler = visCall?.[1] as () => void;

            // Ensure we are marked as subscribed
            (DataRecordSyncEngine as unknown as { isSubscribed: boolean }).isSubscribed = true;
            (MultiRecordSyncEngine as unknown as { isSubscribed: boolean }).isSubscribed = true;
            (UserRecordSyncEngine as unknown as { isSubscribed: boolean }).isSubscribed = true;
            vi.mocked(DataRecordSyncEngine.subscribeRealtime).mockClear();
            vi.mocked(MultiRecordSyncEngine.subscribeRealtime).mockClear();
            vi.mocked(UserRecordSyncEngine.subscribeRealtime).mockClear();

            await visHandler();
            await Promise.resolve();

            expect(DataRecordSyncEngine.subscribeRealtime).not.toHaveBeenCalled();
            expect(MultiRecordSyncEngine.subscribeRealtime).not.toHaveBeenCalled();
            expect(UserRecordSyncEngine.subscribeRealtime).not.toHaveBeenCalled();
            expect(DataRecordSyncEngine.trigger).not.toHaveBeenCalled();
            expect(AssetSyncEngine.start).toHaveBeenCalledTimes(1);
            expect(MultiRecordSyncEngine.trigger).not.toHaveBeenCalled();
            expect(UserRecordSyncEngine.trigger).not.toHaveBeenCalled();
        });

        it('should repair subscriptions on "visibilitychange" if any record sync is disconnected', async () => {
            SyncManager.startAutoSync();

            const visCall = vi
                .mocked(document.addEventListener)
                .mock.calls.find((c) => c[0] === 'visibilitychange');
            const visHandler = visCall?.[1] as () => void;

            (DataRecordSyncEngine as unknown as { isSubscribed: boolean }).isSubscribed = true;
            (MultiRecordSyncEngine as unknown as { isSubscribed: boolean }).isSubscribed = false;
            (UserRecordSyncEngine as unknown as { isSubscribed: boolean }).isSubscribed = true;
            vi.mocked(DataRecordSyncEngine.subscribeRealtime).mockClear();
            vi.mocked(MultiRecordSyncEngine.subscribeRealtime).mockClear();
            vi.mocked(UserRecordSyncEngine.subscribeRealtime).mockClear();
            vi.mocked(DataRecordSyncEngine.trigger).mockClear();
            vi.mocked(MultiRecordSyncEngine.trigger).mockClear();
            vi.mocked(UserRecordSyncEngine.trigger).mockClear();
            vi.mocked(AssetSyncEngine.start).mockClear();

            await visHandler();
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();

            expect(DataRecordSyncEngine.subscribeRealtime).not.toHaveBeenCalled();
            expect(MultiRecordSyncEngine.subscribeRealtime).toHaveBeenCalled();
            expect(UserRecordSyncEngine.subscribeRealtime).not.toHaveBeenCalled();
            expect(DataRecordSyncEngine.trigger).toHaveBeenCalled();
            expect(MultiRecordSyncEngine.trigger).toHaveBeenCalled();
            expect(UserRecordSyncEngine.trigger).toHaveBeenCalled();
            expect(AssetSyncEngine.start).toHaveBeenCalled();
        });

        it('should route user write events to UserRecordSyncEngine', async () => {
            SyncManager.startAutoSync();
            expect(userWriteListener).not.toBeNull();

            userWriteListener?.([
                { tableName: 'users', ids: ['u1'], origin: 'local', operation: 'put' }
            ]);
            await Promise.resolve();
            expect(UserRecordSyncEngine.handleLocalWrite).toHaveBeenCalledWith(
                expect.objectContaining({ tableName: 'users', ids: ['u1'] })
            );
        });

        it('should not push user data for sync-origin user writes', async () => {
            SyncManager.startAutoSync();

            userWriteListener?.([
                { tableName: 'users', ids: ['u1'], origin: 'sync', operation: 'put' }
            ]);
            await Promise.resolve();
            expect(UserRecordSyncEngine.handleLocalWrite).toHaveBeenCalledWith(
                expect.objectContaining({ origin: 'sync' })
            );
        });

        it('should route local DB writes to the appropriate sync engines and start AssetSyncEngine if database change is local', async () => {
            SyncManager.startAutoSync();
            expect(dbWriteListener).not.toBeNull();

            dbWriteListener?.([
                {
                    tableName: 'characters',
                    ids: ['c1'],
                    origin: 'local',
                    operation: 'put'
                }
            ]);

            await Promise.resolve();

            expect(DataRecordSyncEngine.handleLocalWrite).toHaveBeenCalledWith(
                expect.objectContaining({ tableName: 'characters', ids: ['c1'] })
            );
            expect(AssetSyncEngine.start).toHaveBeenCalled();
        });

        it('should route multi metadata writes to MultiRecordSyncEngine', async () => {
            SyncManager.startAutoSync();
            expect(multiWriteListener).not.toBeNull();

            multiWriteListener?.([
                {
                    tableName: 'multi_room_members',
                    ids: ['member-1'],
                    origin: 'local',
                    operation: 'put'
                }
            ]);

            await Promise.resolve();

            expect(MultiRecordSyncEngine.handleLocalWrite).toHaveBeenCalledWith(
                expect.objectContaining({ tableName: 'multi_room_members', ids: ['member-1'] })
            );
        });
    });
});
