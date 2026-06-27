import type { LLMRole } from './models/llm';

export interface RuntimeContext {
    roomId?: string;
    presetId?: string;
    characterId?: string;
    personaId?: string;
    chatId?: string;
    messageId?: string;
    messageIndex?: number;
    speakerId?: string;
    speakerName?: string;
    role?: LLMRole;
}
