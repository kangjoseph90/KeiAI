import { get } from 'svelte/store';
import {
    CharacterService,
    ChatService,
    MultiRoomService,
    PersonaService,
    RoomService,
    type CreateMultiRoomParams,
    type MultiRoom,
    type MultiRoomMember,
    type Room,
    type RoomFields,
    type UpdateMultiRoomIndexParams
} from '$lib/services';
import { getActiveSession } from '$lib/services/session';
import { AppError } from '$lib/types/errors';
import { generateSortOrder, sortByRefs } from '$lib/utils/ordering';
import {
    activeRoomId,
    isMultiRoom,
    multiRoomCharacters,
    multiRoomMembers,
    multiRoomMetas,
    multiRoomPersonas,
    multiRooms,
    roomChats
} from '../state';
import { clearActiveRoom, updateRoom } from './room';
import { ensureRoomHasChat, selectChat } from './chat';
import { getAppSettings, updateSettings } from './settings';

function setRoomMembers(roomId: string, members: MultiRoomMember[]): void {
    multiRoomMembers.update((current) => {
        const next = new Map(current);
        next.set(roomId, members);
        return next;
    });
}

function upsertRoomMember(member: MultiRoomMember): void {
    multiRoomMembers.update((current) => {
        const next = new Map(current);
        const members = next.get(member.roomId) ?? [];
        const index = members.findIndex((item) => item.id === member.id);
        const updated =
            index === -1
                ? [...members, member]
                : members.map((item) => (item.id === member.id ? member : item));
        updated.sort((a, b) => a.createdAt - b.createdAt);
        next.set(member.roomId, updated);
        return next;
    });
}

export async function loadMultiRooms(): Promise<void> {
    await MultiRoomService.purgeInaccessibleRoomContent();
    const settings = await getAppSettings();
    const [rooms, metas] = await Promise.all([
        MultiRoomService.listRooms(),
        MultiRoomService.listIndexes()
    ]);
    multiRooms.setAll(sortByRefs(rooms, settings.multiRooms.refs));
    multiRoomMetas.setAll(metas);
}

export async function loadMultiRoomMetas(): Promise<void> {
    multiRoomMetas.setAll(await MultiRoomService.listIndexes());
}

export async function getMultiRoomMeta(roomId: string): Promise<MultiRoom> {
    const cached = multiRoomMetas.get(roomId);
    if (cached) return cached;
    const meta = await MultiRoomService.getIndex(roomId);
    multiRoomMetas.set(meta.id, meta);
    return meta;
}

export async function updateMultiRoomIndex(
    roomId: string,
    changes: UpdateMultiRoomIndexParams
): Promise<MultiRoom> {
    const meta = await MultiRoomService.updateIndex(roomId, changes);
    multiRoomMetas.set(meta.id, meta);
    return meta;
}

export async function loadMultiRoomMembers(roomId: string): Promise<MultiRoomMember[]> {
    const members = await MultiRoomService.listMembers(roomId);
    setRoomMembers(roomId, members);
    return members;
}

export async function loadOwnedMultiRoomMembers(): Promise<void> {
    const { userId } = getActiveSession();
    const metas = await MultiRoomService.listIndexes();
    await Promise.all(
        metas
            .filter((meta) => meta.ownerUserId === userId)
            .map(async (meta) => {
                try {
                    setRoomMembers(meta.id, await MultiRoomService.listMembers(meta.id));
                } catch {
                    // A stale owner-visible room should not block the home view.
                }
            })
    );
}

export async function selectMultiRoom(roomId: string): Promise<void> {
    clearActiveRoom();
    const meta = await MultiRoomService.openRoom(roomId);
    const room = await RoomService.get(roomId);
    if (!room) throw new AppError('NOT_FOUND', `Multi room not found: ${roomId}`);

    isMultiRoom.set(true);
    multiRooms.set(room.id, room);
    multiRoomMetas.set(meta.id, meta);
    activeRoomId.set(room.id);

    const [chatList, characterList, personaList, members] = await Promise.all([
        ChatService.listByRoom(roomId),
        CharacterService.list('room'),
        PersonaService.list('room'),
        MultiRoomService.listMembers(roomId)
    ]);

    multiRoomCharacters.setAll(characterList);
    multiRoomPersonas.setAll(personaList);
    setRoomMembers(roomId, members);
    roomChats.setAll(sortByRefs(chatList, room.chats.refs));

    const characterIds = new Set(characterList.map((character) => character.id));
    const staleCharacterRefs: Record<string, undefined> = {};
    for (const id of Object.keys(room.characters.refs)) {
        if (!characterIds.has(id)) staleCharacterRefs[id] = undefined;
    }

    if (Object.keys(staleCharacterRefs).length > 0) {
        await updateRoom(roomId, {
            characters: { refs: staleCharacterRefs }
        });
    }

    if (roomChats.size === 0) {
        await ensureRoomHasChat(roomId);
    }

    const lastActive = room.lastActiveChatId;
    const fallbackId = get(roomChats)[0]?.id;
    const targetId = lastActive && roomChats.get(lastActive) ? lastActive : fallbackId;
    if (targetId) {
        await selectChat(targetId);
    }
}

export async function createMultiRoom(fields: CreateMultiRoomParams): Promise<Room> {
    const settings = await getAppSettings();
    const room = await MultiRoomService.createRoom({
        visibility: fields.visibility,
        publicName: fields.publicName,
        name: fields.name
    });

    const sortOrder = generateSortOrder(settings.multiRooms.refs, settings.multiRooms.folders);
    try {
        await updateSettings({
            multiRooms: { refs: { [room.id]: { id: room.id, sortOrder } } }
        });
    } catch (error) {
        await MultiRoomService.deleteRoom(room.id);
        throw error;
    }

    const meta = await MultiRoomService.getIndex(room.id);
    multiRooms.set(room.id, room);
    multiRoomMetas.set(meta.id, meta);
    setRoomMembers(room.id, await MultiRoomService.listMembers(room.id));
    return room;
}

export async function deleteMultiRoom(roomId: string): Promise<void> {
    const settings = await getAppSettings();
    const existingRef = settings.multiRooms.refs[roomId];

    await updateSettings({ multiRooms: { refs: { [roomId]: undefined } } });

    try {
        await MultiRoomService.deleteRoom(roomId);
    } catch (error) {
        await updateSettings({ multiRooms: { refs: { [roomId]: existingRef } } });
        throw error;
    }

    multiRooms.delete(roomId);
    multiRoomMetas.delete(roomId);
    multiRoomMembers.update((current) => {
        const next = new Map(current);
        next.delete(roomId);
        return next;
    });
    if (get(activeRoomId) === roomId) {
        clearActiveRoom();
    }
}

export async function leaveMultiRoom(roomId: string): Promise<void> {
    const settings = await getAppSettings();
    const existingRef = settings.multiRooms.refs[roomId];

    await updateSettings({ multiRooms: { refs: { [roomId]: undefined } } });

    try {
        await MultiRoomService.leaveRoom(roomId);
    } catch (error) {
        await updateSettings({ multiRooms: { refs: { [roomId]: existingRef } } });
        throw error;
    }

    multiRooms.delete(roomId);
    multiRoomMetas.delete(roomId);
    multiRoomMembers.update((current) => {
        const next = new Map(current);
        next.delete(roomId);
        return next;
    });
    if (get(activeRoomId) === roomId) {
        clearActiveRoom();
    }
}

export async function approveMultiRoomJoinRequest(
    roomId: string,
    recipientUserId: string,
    recipientPublicKey: CryptoKey
): Promise<MultiRoomMember> {
    const member = await MultiRoomService.approveJoinRequest(
        roomId,
        recipientUserId,
        recipientPublicKey
    );
    upsertRoomMember(member);
    return member;
}

export async function revokeMultiRoomMember(roomId: string, targetUserId: string): Promise<void> {
    await MultiRoomService.revokeMember(roomId, targetUserId);
    await loadMultiRoomMembers(roomId);
}

export async function requestJoinMultiRoom(roomId: string): Promise<MultiRoomMember> {
    const member = await MultiRoomService.requestJoin(roomId);
    upsertRoomMember(member);
    await loadMultiRoomMetas();
    return member;
}

export async function rejectJoinMultiRoom(roomId: string, targetUserId: string): Promise<void> {
    await MultiRoomService.rejectJoin(roomId, targetUserId);
    await loadMultiRoomMembers(roomId);
}
