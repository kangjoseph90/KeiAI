/**
 * Scope Orphan Purge
 *
 * Manual cleanup utility for records and assets that belong to
 * non-existent users or rooms. This handles edge cases where:
 * - A user was deleted on another device but content wasn't fully purged locally
 * - A room was deleted server-side but local content wasn't cleaned up
 *
 * Used by manual maintenance and after local user deletion.
 */

import { appUser } from '$lib/adapters/user';
import { appMulti } from '$lib/adapters/multi';
import { localDB, TABLES, type DataScope, type DataScopeType } from '$lib/adapters/db';
import { buffer } from './content/record_buffer';
import { AssetService } from './asset';

export interface PurgeResult {
    users: number;
    rooms: number;
}

export async function purgeOrphanScopes(): Promise<PurgeResult> {
    const userResult = await purgeOrphanUserScopes();
    const roomResult = await purgeOrphanRoomScopes();
    return { users: userResult, rooms: roomResult };
}

async function purgeOrphanUserScopes(): Promise<number> {
    const users = await appUser.getAllUsers();
    const activeUserIds = new Set(users.map((u) => u.id));

    // Collect all scopeIds with scopeType='user' that aren't in activeUserIds
    const orphanIds = await collectOrphanScopeIds('user', activeUserIds);

    let purged = 0;
    for (const orphanId of orphanIds) {
        purged += await purgeScope({ scopeType: 'user', scopeId: orphanId });
    }
    return purged;
}

async function purgeOrphanRoomScopes(): Promise<number> {
    // Keep rooms accessible to any local identity, not only the active user.
    const users = await appUser.getAllUsers();
    const memberships = (
        await Promise.all(users.map((user) => appMulti.getMembersByUser(user.id)))
    ).flat();
    const memberRoomIds = new Set(
        memberships.filter((membership) => membership.status === 'accepted').map((m) => m.roomId)
    );

    // Only keep rooms that have a local index (hard-delete removed them)
    const indexes = await appMulti.getRoomIndexes([...memberRoomIds]);
    const activeRoomIds = new Set(indexes.map((idx) => idx.id));

    const orphanIds = await collectOrphanScopeIds('room', activeRoomIds);

    let purged = 0;
    for (const orphanId of orphanIds) {
        purged += await purgeScope({ scopeType: 'room', scopeId: orphanId });
    }
    return purged;
}

/**
 * Scan all tables for scopeIds of a given scopeType not in the active set.
 */
async function collectOrphanScopeIds(
    scopeType: DataScopeType,
    activeIds: Set<string>
): Promise<string[]> {
    await Promise.all(TABLES.map((table) => buffer.flushTable(table)));

    const foundIds = new Set<string>();

    for (const table of TABLES) {
        const ids = await localDB.getScopeIdsByType(table, scopeType);
        for (const id of ids) {
            if (!activeIds.has(id)) {
                foundIds.add(id);
            }
        }
    }

    return [...foundIds];
}

/**
 * Hard-delete all records and assets for a given scope.
 */
async function purgeScope(scope: DataScope): Promise<number> {
    let purged = 0;

    for (const table of TABLES) {
        purged += await localDB.deleteByScope(table, scope, { origin: 'sync' });
    }

    await AssetService.deleteScopeAssets(scope);

    return purged;
}
