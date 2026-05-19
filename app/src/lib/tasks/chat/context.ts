import type { TemplateContext } from '$lib/template';
import type { Message } from '$lib/services/content/message';
import type { LLMRole } from '$lib/types/models/llm';

export function toRoleContext(ctx: TemplateContext, role: LLMRole): TemplateContext {
    return { ...ctx, role };
}

export function toMessageContext(
    message: Message,
    messageIndex: number,
    ctx: TemplateContext
): TemplateContext {
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
