import { AppError } from '$lib/types/errors';
import { createMessageSwipe, deleteMessageSwipe, getMessage, updateMessage } from '$lib/stores';
import type { Message, MessageSwipeFields } from '$lib/services';
import type { AgentPart } from '$lib/workflow/agent/llm';

export interface PrepareNextSwipeInput {
    parts: AgentPart[];
    variables: Record<string, string>;
    speakerId?: string;
    speakerName?: string;
    attachments?: string[];
    replaceActiveSwipe?: boolean;
}

function buildSwipeFields(input: PrepareNextSwipeInput): MessageSwipeFields {
    const fields: MessageSwipeFields = {
        parts: input.parts,
        variables: input.variables
    };

    if (input.speakerId !== undefined) fields.speakerId = input.speakerId;
    if (input.speakerName !== undefined) fields.speakerName = input.speakerName;
    if (input.attachments?.length) fields.attachments = Array.from(input.attachments);

    return fields;
}

export async function prepareNextSwipe(
    message: Message,
    input: PrepareNextSwipeInput
): Promise<{ swipeId: string; message: Message }> {
    let current = message;

    if (
        input.replaceActiveSwipe &&
        current.activeSwipeId &&
        current.swipes[current.activeSwipeId]
    ) {
        current = await deleteMessageSwipe(current.id, current.activeSwipeId);
    }

    const created = await createMessageSwipe(current.id, buildSwipeFields(input));

    await updateMessage(current.id, { activeSwipeId: created.swipeId });

    const updated = await getMessage(current.id);
    if (!updated) {
        throw new AppError('NOT_FOUND', `Message not found: ${current.id}`);
    }

    return {
        swipeId: created.swipeId,
        message: updated
    };
}
