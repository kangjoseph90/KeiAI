import { synthesizeSpeechInlay } from '$lib/managers/media';
import { AppError } from '$lib/types/errors';
import type { TTSNode, WorkflowNodeExecutionContext } from '../types';
import { createWorkflowValueEvent } from '../util';
import { requireStringInput } from '../operator/utils';
import { serializeAgentParts } from './llm';

export async function executeTTSNode({
    inputs,
    output,
    ctx,
    signal
}: WorkflowNodeExecutionContext<TTSNode>): Promise<void> {
    if (!ctx?.chatId) {
        throw new AppError('INVALID_INPUT', 'Text to Speech node requires ctx.chatId');
    }

    const text = await requireStringInput(
        inputs.text,
        'Text to Speech text input is required',
        signal
    );
    if (!text.trim()) {
        throw new AppError('INVALID_INPUT', 'Text to Speech text cannot be empty');
    }

    const ref = await synthesizeSpeechInlay(ctx.chatId, text, signal);
    output.emit(0, createWorkflowValueEvent(serializeAgentParts([{ type: 'inlay', ids: [ref] }])));
}
