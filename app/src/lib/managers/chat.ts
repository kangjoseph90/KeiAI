import { MessageService, LorebookService } from '$lib/services';
import { compareSortOrder } from '$lib/utils/ordering';
import {
    createChat,
    createChatLorebook,
    createMessage,
    deleteMessage,
    getActivePreset,
    getCharacter,
    getChat,
    getMessage,
    getRoom,
    updateChat,
    updateMessage
} from '$lib/stores';
import { AppError } from '$lib/types/errors';

// ─── Greeting ─────────────────────────────────────

export async function syncChatGreetings(chatId: string): Promise<void> {
    const chat = await getChat(chatId);
    if (!chat) return;

    if (chat.lastMessageId && chat.lastMessageId !== chat.greetingMessageId) return;

    const room = await getRoom(chat.roomId);
    if (!room) return;

    const refs = Object.values(room.characters.refs)
        .filter((ref) => ref.enabled !== false)
        .sort((a, b) => compareSortOrder(a.sortOrder, b.sortOrder));

    const characters = await Promise.all(refs.map((ref) => getCharacter(ref.id)));
    const variables = await getChatDefaultVariables(chat.id);

    const greetingSwipes = Object.fromEntries(
        characters.flatMap((character) => {
            if (!character) return [];
            return Object.values(character.greetings)
                .sort((a, b) => compareSortOrder(a.sortOrder, b.sortOrder))
                .map((greeting) => [
                    greeting.id,
                    {
                        id: greeting.id,
                        content: greeting.content,
                        createdAt: Date.now(),
                        variables,
                        speakerId: character.id,
                        speakerName: character.name
                    }
                ]);
        })
    );
    const greetingIds = Object.keys(greetingSwipes);
    const activeSwipeId = greetingIds[0] ?? '';

    if (greetingIds.length === 0) {
        if (!chat.greetingMessageId) return;

        const greetingMessageId = chat.greetingMessageId;
        await updateChat(chat.id, {
            greetingMessageId: undefined,
            lastMessageId: undefined
        });

        await deleteMessage(chat.id, greetingMessageId);
        return;
    }

    if (chat.greetingMessageId) {
        const greetingMessageId = chat.greetingMessageId;
        const message = await getMessage(greetingMessageId);
        if (message) {
            const removedSwipes = Object.fromEntries(
                Object.keys(message.swipes).map((id) => [id, undefined])
            );
            const swipePatch = { ...removedSwipes, ...greetingSwipes };

            await updateMessage(greetingMessageId, {
                swipes: swipePatch,
                activeSwipeId: greetingSwipes[message.activeSwipeId]
                    ? message.activeSwipeId
                    : activeSwipeId
            });
            return;
        }
    }

    const message = await createMessage(chat.id, {
        role: 'assistant',
        swipes: greetingSwipes,
        activeSwipeId
    });

    await updateChat(chat.id, {
        greetingMessageId: message.id,
        lastMessageId: message.id
    });
}

// ─── Variables ──────────────────────────────────────

export async function getChatVariable(chatId: string, key: string): Promise<string | null> {
    const variables = await getChatVariables(chatId);
    if (variables[key] !== undefined) return variables[key];

    const chat = await getChat(chatId);
    if (!chat || !chat.lastMessageId) return null;

    const lastMessage = await getMessage(chat.lastMessageId);
    if (!lastMessage) return null;

    const swipe = lastMessage.swipes[lastMessage.activeSwipeId];
    if (!swipe) return null;

    return swipe.variables?.[key] ?? null;
}

export async function setChatVariable(chatId: string, key: string, value: string): Promise<void> {
    const chat = await getChat(chatId);
    if (!chat || !chat.lastMessageId) return;

    const lastMessage = await getMessage(chat.lastMessageId);
    if (!lastMessage) return;

    const swipe = lastMessage.swipes[lastMessage.activeSwipeId];
    if (!swipe) return;

    await updateMessage(lastMessage.id, {
        swipes: {
            [lastMessage.activeSwipeId]: {
                variables: {
                    [key]: value
                }
            }
        }
    });
}

export async function getChatVariables(chatId: string): Promise<Record<string, string>> {
    const defaults = await getChatDefaultVariables(chatId);
    const chat = await getChat(chatId);
    if (!chat) return defaults;

    if (!chat.lastMessageId) return { ...defaults };

    const lastMessage = await getMessage(chat.lastMessageId);
    if (!lastMessage) return { ...defaults };
    const swipe = lastMessage.swipes[lastMessage.activeSwipeId];
    if (!swipe) return { ...defaults };

    return { ...defaults, ...swipe.variables };
}

export async function getChatVariablesBefore(
    chatId: string,
    beforeSortOrder: string
): Promise<Record<string, string>> {
    const defaults = await getChatDefaultVariables(chatId);
    const [previousMessage] = await MessageService.getMessagesBefore(chatId, beforeSortOrder, 1);
    if (!previousMessage) return defaults;

    const swipe = previousMessage.swipes[previousMessage.activeSwipeId];
    if (!swipe) return defaults;

    return { ...defaults, ...swipe.variables };
}

export async function getChatDefaultVariables(chatId: string): Promise<Record<string, string>> {
    const chat = await getChat(chatId);
    if (!chat) return {};

    const room = await getRoom(chat.roomId);
    if (!room) return {};

    const refs = Object.values(room.characters.refs)
        .filter((ref) => ref.enabled !== false)
        .sort((a, b) => compareSortOrder(a.sortOrder, b.sortOrder));

    const entries = await Promise.all(
        refs.map(async (ref) => [ref.id, await getCharacter(ref.id)] as const)
    );

    const variables: Record<string, string> = { ...(getActivePreset()?.defaultVariables ?? {}) };
    for (const [, character] of entries) {
        if (!character) continue;
        Object.assign(variables, character.defaultVariables);
    }

    return variables;
}

export async function setChatVariables(
    chatId: string,
    variables: Record<string, string>
): Promise<void> {
    const chat = await getChat(chatId);
    if (!chat || !chat.lastMessageId) return;

    const lastMessage = await getMessage(chat.lastMessageId);
    if (!lastMessage) return;
    const swipe = lastMessage.swipes[lastMessage.activeSwipeId];
    if (!swipe) return;

    await updateMessage(lastMessage.id, {
        swipes: {
            [lastMessage.activeSwipeId]: {
                variables
            }
        }
    });
}

// ─── Fork ──────────────────────────────────────────

/**
 * Forks a chat at a specific message, copying all history up to that point
 * into a new thread. Includes chat-specific lorebooks.
 */
export async function forkChat(messageId: string): Promise<string> {
    const forkMessage = await getMessage(messageId);
    if (!forkMessage) throw new AppError('NOT_FOUND', `Message not found: ${messageId}`);
    const originalChat = await getChat(forkMessage.chatId);
    if (!originalChat) throw new AppError('NOT_FOUND', `Chat not found: ${forkMessage.chatId}`);

    // Create new chat with metadata from original
    const {
        id: _id,
        roomId: _roomId,
        lorebooks: _,
        personas: _personas,
        lastMessageId: __,
        greetingMessageId: ___,
        ...fieldsCopy
    } = originalChat;

    const newChat = await createChat(originalChat.roomId, {
        ...fieldsCopy,
        title: `${originalChat.title} (Fork)`
    });

    // Copy history up to the fork point
    const beforeMessages = await MessageService.getMessagesBefore(
        forkMessage.chatId,
        forkMessage.sortOrder,
        Number.MAX_SAFE_INTEGER
    );
    const allMessages = [...beforeMessages, forkMessage];

    // creation using store CRUD - this ensures lastMessageId is correctly updated
    // and stores are notified if the new chat is active.
    for (const msg of allMessages) {
        await createMessage(newChat.id, {
            role: msg.role,
            swipes: msg.swipes,
            activeSwipeId: msg.activeSwipeId
        });
    }

    // Copy chat-specific lorebooks
    const lorebooks = await LorebookService.listByOwner(originalChat.id);
    for (const lb of lorebooks) {
        const { id: _lbId, ownerId: _ownerId, ...lbFields } = lb;
        await createChatLorebook(newChat.id, lbFields);
    }

    return newChat.id;
}
