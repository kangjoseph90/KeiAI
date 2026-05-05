import type { Greeting } from '$lib/services';
import {
    createMessage,
    deleteMessage,
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
