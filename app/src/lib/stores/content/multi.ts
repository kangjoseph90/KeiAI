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
import { AppError } from '$lib/types/errors';
import { sortByRefs } from '$lib/utils/ordering';
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

function assertActiveMultiRoom(roomId: string): void {
    if (!get(isMultiRoom) || get(activeRoomId) !== roomId) {
        throw new AppError('INVALID_INPUT', `Multi room is not active: ${roomId}`);
    }
}

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
    const [rooms, metas] = await Promise.all([
        MultiRoomService.listRooms(),
        MultiRoomService.listIndexes()
    ]);
    multiRooms.setAll(rooms);
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
}

export function clearActiveMultiRoom(): void {
    clearActiveRoom();
}

export async function createMultiRoom(fields: CreateMultiRoomParams): Promise<Room> {
    const room = await MultiRoomService.createRoom({
        visibility: fields.visibility,
        publicName: fields.publicName,
        name: fields.name
    });
    const meta = await MultiRoomService.getIndex(room.id);
    multiRooms.set(room.id, room);
    multiRoomMetas.set(meta.id, meta);
    setRoomMembers(room.id, await MultiRoomService.listMembers(room.id));
    return room;
}

export async function deleteMultiRoom(roomId: string): Promise<void> {
    assertActiveMultiRoom(roomId);
    await MultiRoomService.deleteRoom(roomId);
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

export async function inviteMultiRoomMember(
    roomId: string,
    recipientUserId: string,
    recipientPublicKey: CryptoKey
): Promise<MultiRoomMember> {
    const member = await MultiRoomService.inviteMember(roomId, recipientUserId, recipientPublicKey);
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
