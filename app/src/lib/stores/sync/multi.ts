import { appMulti } from '$lib/adapters/multi';
import { MultiRoomService, type MultiRoomMember } from '$lib/services';
import { createLogger } from '$lib/adapters/logger';
import { multiRoomMembers, multiRoomMetas } from '../state';

let stopMultiStoreSyncListener: (() => void) | null = null;
const logger = createLogger('store:sync:multi');

function setRoomMembers(roomId: string, members: MultiRoomMember[]): void {
    multiRoomMembers.update((current) => {
        const next = new Map(current);
        next.set(roomId, members);
        return next;
    });
}

async function refreshRoomMembersByMemberIds(ids: string[]): Promise<void> {
    const members = await Promise.all(ids.map((id) => appMulti.getMember(id)));
    const roomIds = Array.from(
        new Set(members.flatMap((member) => (member ? [member.roomId] : [])))
    );

    await Promise.all(
        roomIds.map(async (roomId) => {
            try {
                setRoomMembers(roomId, await MultiRoomService.listMembers(roomId));
            } catch {
                multiRoomMembers.update((current) => {
                    const next = new Map(current);
                    next.delete(roomId);
                    return next;
                });
            }
        })
    );
}

async function getMultiRoomMetaOrNull(roomId: string) {
    try {
        return await MultiRoomService.getIndex(roomId);
    } catch {
        return null;
    }
}

export function startMultiStoreSync(): void {
    if (stopMultiStoreSyncListener) return;

    stopMultiStoreSyncListener = appMulti.subscribeWriteEvents(async (events) => {
        const mergedEvents: Record<string, string[]> = {};
        for (const event of events) {
            if (event.origin !== 'sync') continue;
            mergedEvents[event.tableName] ??= [];
            mergedEvents[event.tableName].push(...event.ids);
        }

        for (const [tableName, allIds] of Object.entries(mergedEvents)) {
            const ids = Array.from(new Set(allIds));

            try {
                switch (tableName) {
                    case 'multi_room_index': {
                        const metas = await Promise.all(
                            ids.map(async (id) => [id, await getMultiRoomMetaOrNull(id)] as const)
                        );
                        multiRoomMetas.batch(() => {
                            for (const [id, meta] of metas) {
                                if (meta) {
                                    multiRoomMetas.set(id, meta);
                                } else {
                                    multiRoomMetas.delete(id);
                                }
                            }
                        });
                        break;
                    }
                    case 'multi_room_members': {
                        await refreshRoomMembersByMemberIds(ids);
                        break;
                    }
                }
            } catch (error) {
                logger.warn(`Error handling synced multi table ${tableName}`, error);
            }
        }
    });
}

export function stopMultiStoreSync(): void {
    stopMultiStoreSyncListener?.();
    stopMultiStoreSyncListener = null;
}
