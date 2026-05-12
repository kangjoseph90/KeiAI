import { AppError } from '$lib/types/errors';
import { createMessageSwipe, deleteMessageSwipe, getMessage, updateMessage } from '$lib/stores';
import type { Message } from '$lib/services';

export interface PrepareNextSwipeInput {
    content: string;
    variables: Record<string, string>;
    speakerId?: string;
    speakerName?: string;
    replaceActiveSwipe?: boolean;
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

    const created = await createMessageSwipe(current.id, {
        content: input.content,
        variables: input.variables,
        speakerId: input.speakerId,
        speakerName: input.speakerName
    });

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
