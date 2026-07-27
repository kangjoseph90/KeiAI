import { generateImageInlay } from '$lib/managers/media';
import { AppError } from '$lib/types/errors';
import type { ImageGenerationNode, WorkflowNodeExecutionContext } from '../types';
import { createWorkflowValueEvent } from '../util';
import { optionalStringInput, requireStringInput } from '../operator/utils';
import { deserializeAgentParts, serializeAgentParts } from './llm';

export async function executeImageGenerationNode({
    inputs,
    output,
    ctx,
    signal
}: WorkflowNodeExecutionContext<ImageGenerationNode>): Promise<void> {
    if (!ctx?.chatId) {
        throw new AppError('INVALID_INPUT', 'Image Generation node requires ctx.chatId');
    }

    const [prompt, negativePrompt, referenceContent, styleContent] = await Promise.all([
        requireStringInput(inputs.prompt, 'Image Generation prompt input is required', signal),
        optionalStringInput(inputs.negativePrompt, signal),
        optionalStringInput(inputs.referenceImages, signal),
        optionalStringInput(inputs.styleImages, signal)
    ]);
    if (!prompt.trim()) {
        throw new AppError('INVALID_INPUT', 'Image Generation prompt cannot be empty');
    }

    const ref = await generateImageInlay(
        ctx.chatId,
        {
            prompt,
            ...(negativePrompt.trim() ? { negativePrompt } : {}),
            referenceImageInlayIds: collectInlayIds(referenceContent),
            styleImageInlayIds: collectInlayIds(styleContent)
        },
        signal
    );
    output.emit(0, createWorkflowValueEvent(serializeAgentParts([{ type: 'inlay', ids: [ref] }])));
}

function collectInlayIds(content: string): string[] {
    const ids: string[] = [];
    for (const part of deserializeAgentParts(content)) {
        if (part.type !== 'inlay') continue;
        ids.push(...part.ids);
    }
    return ids;
}
