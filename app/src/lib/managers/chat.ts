import { MessageService, LorebookService, type Greeting } from '$lib/services';
import {
    createChat,
    createChatLorebook,
    createMessage,
    deleteMessage,
    getCharacter,
    getChat,
    getMessage,
    updateChat,
    updateMessage
} from '$lib/stores';

// ─── Greeting ─────────────────────────────────────

export async function setGreetings(
    chatId: string,
    greetings: Record<string, Greeting>
): Promise<void> {
    const chat = await getChat(chatId);

    if (chat.lastMessageId && chat.lastMessageId !== chat.greetingMessageId) return;

    const greetingIds = Object.keys(greetings);
    const activeSwipeId = greetingIds[0] ?? '';

    const greetingSwipes = Object.fromEntries(
        greetingIds.map((id) => {
            const greeting = greetings[id];
            return [id, { id, content: greeting.content, createdAt: greeting.createdAt }];
        })
    );

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
                activeSwipeId: greetings[message.activeSwipeId]
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
    const chat = await getChat(chatId);
    if (!chat.lastMessageId) return null;

    const lastMessage = await getMessage(chat.lastMessageId);

    const swipe = lastMessage.swipes[lastMessage.activeSwipeId];
    if (!swipe) return null;

    return swipe.variables?.[key] ?? null;
}

export async function setChatVariable(chatId: string, key: string, value: string): Promise<void> {
    const chat = await getChat(chatId);
    if (!chat.lastMessageId) return;

    const lastMessage = await getMessage(chat.lastMessageId);
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
    const chat = await getChat(chatId);
    const char = await getCharacter(chat.characterId);
    if (!chat.lastMessageId) return { ...char.defaultVariables };

    const lastMessage = await getMessage(chat.lastMessageId);
    const swipe = lastMessage.swipes[lastMessage.activeSwipeId];
    if (!swipe) return { ...char.defaultVariables };

    return { ...char.defaultVariables, ...swipe.variables };
}

export async function setChatVariables(
    chatId: string,
    variables: Record<string, string>
): Promise<void> {
    const chat = await getChat(chatId);
    if (!chat.lastMessageId) return;

    const lastMessage = await getMessage(chat.lastMessageId);
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
    const originalChat = await getChat(forkMessage.chatId);

    // Create new chat with metadata from original
    const {
        id: _id,
        characterId: _charId,
        lorebooks: _,
        lastMessageId: __,
        greetingMessageId: ___,
        ...fieldsCopy
    } = originalChat;

    const newChat = await createChat(originalChat.characterId, {
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
