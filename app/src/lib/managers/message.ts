import { AppError } from '$lib/types/errors';
import { getMessage, updateMessage } from '$lib/stores';
import type { Message, MessageSwipeFields } from '$lib/services';
import type { AgentPart } from '$lib/workflow/agent/llm';
import { clock } from '$lib/utils/clock';
import { generateId } from '$lib/utils/id';

export interface PrepareNextSwipeInput {
    parts: AgentPart[];
    variables: Record<string, string>;
    speakerId?: string;
    speakerName?: string;
    replaceActiveSwipe?: boolean;
}

function buildSwipeFields(input: PrepareNextSwipeInput): MessageSwipeFields {
    const fields: MessageSwipeFields = {
        parts: input.parts,
        variables: input.variables
    };

    if (input.speakerId !== undefined) fields.speakerId = input.speakerId;
    if (input.speakerName !== undefined) fields.speakerName = input.speakerName;
    return fields;
}

export async function prepareNextSwipe(
    message: Message,
    input: PrepareNextSwipeInput
): Promise<{ swipeId: string; message: Message }> {
    const swipeId = generateId();
    const removedSwipeId =
        input.replaceActiveSwipe && message.swipes[message.activeSwipeId]
            ? message.activeSwipeId
            : undefined;

    await updateMessage(message.id, {
        swipes: {
            ...(removedSwipeId ? { [removedSwipeId]: undefined } : {}),
            [swipeId]: {
                ...buildSwipeFields(input),
                id: swipeId,
                createdAt: clock.now()
            }
        },
        activeSwipeId: swipeId
    });

    const updated = await getMessage(message.id);
    if (!updated) {
        throw new AppError('NOT_FOUND', `Message not found: ${message.id}`);
    }

    return {
        swipeId,
        message: updated
    };
}
