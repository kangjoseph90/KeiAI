import type { Message } from '$lib/services/content/message';
import type { LLMRole } from '$lib/types/models/llm';
import type { RuntimeContext } from '$lib/types/context';

export function toRoleContext(ctx: RuntimeContext, role: LLMRole): RuntimeContext {
    return { ...ctx, role };
}

export function toMessageContext(
    message: Message,
    messageIndex: number,
    ctx: RuntimeContext
): RuntimeContext {
    const activeSwipe = message.swipes[message.activeSwipeId];
    return {
        ...ctx,
        messageId: message.id,
        messageIndex,
        role: message.role,
        speakerId: activeSwipe?.speakerId,
        speakerName: activeSwipe?.speakerName,
        ...(message.role === 'assistant' && activeSwipe?.speakerId
            ? { characterId: activeSwipe.speakerId }
            : {}),
        ...(message.role === 'user' && activeSwipe?.speakerId
            ? { personaId: activeSwipe.speakerId }
            : {})
    };
}
