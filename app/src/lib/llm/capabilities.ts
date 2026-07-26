import type { LLMContentPart, LLMMessage } from './types';
import type { LLMCapabilities, LLMCapability } from '$lib/types/models/llm';

export type LLMMediaContentPart = Extract<LLMContentPart, { type: 'image' | 'audio' | 'video' }>;

const mediaCapabilities: Record<LLMMediaContentPart['type'], LLMCapability> = {
    image: 'image_input',
    audio: 'audio_input',
    video: 'video_input'
};

export function getMediaInputCapability(part: LLMMediaContentPart): LLMCapability {
    return mediaCapabilities[part.type];
}

export function adaptMediaForCapabilities(
    messages: LLMMessage[],
    unsupported: LLMCapabilities
): LLMMessage[] {
    if (
        !unsupported.includes('image_input') &&
        !unsupported.includes('audio_input') &&
        !unsupported.includes('video_input')
    ) {
        return messages;
    }

    return messages.map((message) => ({
        ...message,
        content: message.content.map((part): LLMContentPart => {
            if (part.type !== 'image' && part.type !== 'audio' && part.type !== 'video') {
                return part;
            }
            return unsupported.includes(getMediaInputCapability(part))
                ? { type: 'text', text: `[${capitalize(part.type)} omitted: unsupported by model]` }
                : part;
        })
    }));
}

function capitalize(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
}
