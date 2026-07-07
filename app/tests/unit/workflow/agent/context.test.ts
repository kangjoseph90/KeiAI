import { describe, expect, it } from 'vitest';
import { toMessageContext, toRoleContext } from '$lib/workflow/agent/context';
import type { Message } from '$lib/services';
import type { RuntimeContext } from '$lib/types/context';

const baseContext: RuntimeContext = {
    chatId: 'chat-1',
    characterId: 'char-default',
    personaId: 'persona-default'
};

function makeMessage(role: Message['role'], speakerId?: string, speakerName?: string): Message {
    return {
        id: `msg-${role}`,
        chatId: 'chat-1',
        scopeType: 'user',
        scopeId: 'user-1',
        role,
        sortOrder: 'a',
        activeSwipeId: 'swipe-1',
        swipes: {
            'swipe-1': {
                id: 'swipe-1',
                parts: [{ type: 'content', text: 'Hello' }],
                createdAt: 1,
                speakerId,
                speakerName
            }
        }
    };
}

describe('chat task context helpers', () => {
    it('overrides persona context from user message speaker', () => {
        const ctx = toMessageContext(makeMessage('user', 'persona-2', 'Mina'), 3, baseContext);

        expect(ctx).toMatchObject({
            chatId: 'chat-1',
            characterId: 'char-default',
            personaId: 'persona-2',
            messageId: 'msg-user',
            messageIndex: 3,
            role: 'user',
            speakerId: 'persona-2',
            speakerName: 'Mina'
        });
    });

    it('overrides character context from assistant message speaker', () => {
        const ctx = toMessageContext(makeMessage('assistant', 'char-2', 'Beta'), 4, baseContext);

        expect(ctx).toMatchObject({
            chatId: 'chat-1',
            characterId: 'char-2',
            personaId: 'persona-default',
            messageId: 'msg-assistant',
            messageIndex: 4,
            role: 'assistant',
            speakerId: 'char-2',
            speakerName: 'Beta'
        });
    });

    it('keeps base context when the active swipe has no speaker', () => {
        const ctx = toMessageContext(makeMessage('assistant'), 0, baseContext);

        expect(ctx).toMatchObject({
            characterId: 'char-default',
            personaId: 'persona-default',
            speakerId: undefined,
            speakerName: undefined
        });
    });

    it('derives role contexts without dropping ids', () => {
        expect(toRoleContext(baseContext, 'assistant')).toMatchObject({
            characterId: 'char-default',
            personaId: 'persona-default',
            role: 'assistant'
        });
    });
});
