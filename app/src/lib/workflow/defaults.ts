import type { AgentNode, PromptBlock, WorkflowDefinition } from './types';

export const DEFAULT_CHAT_AGENT_ID = 'chat_agent';
export const DEFAULT_CHAT_OUTPUT_ID = 'output';
export const DEFAULT_TRANSLATION_AGENT_ID = 'translation_agent';
export const DEFAULT_TRANSLATION_OUTPUT_ID = 'translation_output';
export const DEFAULT_IMAGE_GENERATION_NODE_ID = 'image_generation';
export const DEFAULT_IMAGE_GENERATION_OUTPUT_ID = 'image_generation_output';
export const DEFAULT_TTS_NODE_ID = 'tts';
export const DEFAULT_TTS_OUTPUT_ID = 'tts_output';
export const DEFAULT_SUGGESTION_AGENT_ID = 'suggestion_agent';
export const DEFAULT_SUGGESTION_OUTPUT_ID = 'suggestion_output';

export interface DefaultChatWorkflowOptions {
    agentName?: string;
    promptBlocks?: Record<string, PromptBlock>;
    maxContext?: number;
    maxResponse?: number;
    lorebookRatio?: number;
    memoryRatio?: number;
    lorebookScanDepth?: number;
}

export function createDefaultChatWorkflow(
    options: DefaultChatWorkflowOptions = {}
): WorkflowDefinition {
    const agent: AgentNode = {
        id: DEFAULT_CHAT_AGENT_ID,
        name: options.agentName ?? 'Chat Agent',
        class: 'Agent',
        position: { x: 0, y: 0 },
        collapsed: false,
        llmType: 'chat',
        toolIds: [],
        promptBlocks: options.promptBlocks ?? {},
        maxContext: options.maxContext ?? 60000,
        maxResponse: options.maxResponse ?? 6000,
        lorebookRatio: options.lorebookRatio ?? 0.2,
        memoryRatio: options.memoryRatio ?? 0.2,
        lorebookScanDepth: options.lorebookScanDepth ?? 5,
        slotNames: {},
        inputs: { stream: null },
        inputValues: { stream: true }
    };

    return {
        nodes: {
            [agent.id]: agent,
            [DEFAULT_CHAT_OUTPUT_ID]: {
                id: DEFAULT_CHAT_OUTPUT_ID,
                name: 'Output',
                class: 'Output',
                position: { x: 360, y: 0 },
                collapsed: false,
                inputs: {
                    content: {
                        sourceNode: agent.id,
                        sourcePort: 0
                    }
                },
                inputValues: {}
            }
        }
    };
}

export function createDefaultTranslationWorkflow(): WorkflowDefinition {
    const instructionId = 'translation_instruction';
    const agent: AgentNode = {
        id: DEFAULT_TRANSLATION_AGENT_ID,
        name: 'Translator',
        class: 'Agent',
        position: { x: 0, y: 0 },
        collapsed: false,
        llmType: 'translation',
        toolIds: [],
        promptBlocks: {
            [instructionId]: {
                id: instructionId,
                name: 'Translation Instruction',
                type: 'message',
                role: 'user',
                content:
                    'Translate the following text from {{sourcelang}} into {{targetlang}}. Return only the translated text.\n\n{{source}}',
                sortOrder: 'a0',
                enabled: true
            }
        },
        maxContext: 60000,
        maxResponse: 6000,
        lorebookRatio: 0.2,
        memoryRatio: 0.2,
        lorebookScanDepth: 5,
        slotNames: {},
        inputs: { stream: null },
        inputValues: { stream: true }
    };

    return {
        nodes: {
            [agent.id]: agent,
            [DEFAULT_TRANSLATION_OUTPUT_ID]: {
                id: DEFAULT_TRANSLATION_OUTPUT_ID,
                name: 'Output',
                class: 'Output',
                position: { x: 360, y: 0 },
                collapsed: false,
                inputs: {
                    content: {
                        sourceNode: agent.id,
                        sourcePort: 0
                    }
                },
                inputValues: {}
            }
        }
    };
}

export function createDefaultImageGenerationWorkflow(): WorkflowDefinition {
    const sourceId = 'image_generation_source';
    return {
        nodes: {
            [sourceId]: {
                id: sourceId,
                name: 'Image Prompt',
                class: 'Template',
                position: { x: 0, y: 0 },
                collapsed: false,
                inputs: { content: null, stream: null },
                inputValues: { content: '{{source}}', stream: false }
            },
            [DEFAULT_IMAGE_GENERATION_NODE_ID]: {
                id: DEFAULT_IMAGE_GENERATION_NODE_ID,
                name: 'Image Generation',
                class: 'ImageGeneration',
                position: { x: 360, y: 0 },
                collapsed: false,
                inputs: {
                    prompt: { sourceNode: sourceId, sourcePort: 0 },
                    negativePrompt: null,
                    referenceImages: null,
                    styleImages: null
                },
                inputValues: {
                    prompt: '',
                    negativePrompt: ''
                }
            },
            [DEFAULT_IMAGE_GENERATION_OUTPUT_ID]: {
                id: DEFAULT_IMAGE_GENERATION_OUTPUT_ID,
                name: 'Output',
                class: 'Output',
                position: { x: 720, y: 0 },
                collapsed: false,
                inputs: {
                    content: {
                        sourceNode: DEFAULT_IMAGE_GENERATION_NODE_ID,
                        sourcePort: 0
                    }
                },
                inputValues: {}
            }
        }
    };
}

export function createDefaultTTSWorkflow(): WorkflowDefinition {
    const sourceId = 'tts_source';
    return {
        nodes: {
            [sourceId]: {
                id: sourceId,
                name: 'Speech Text',
                class: 'Template',
                position: { x: 0, y: 0 },
                collapsed: false,
                inputs: { content: null, stream: null },
                inputValues: { content: '{{source}}', stream: false }
            },
            [DEFAULT_TTS_NODE_ID]: {
                id: DEFAULT_TTS_NODE_ID,
                name: 'Text to Speech',
                class: 'TTS',
                position: { x: 360, y: 0 },
                collapsed: false,
                inputs: {
                    text: { sourceNode: sourceId, sourcePort: 0 }
                },
                inputValues: { text: '' }
            },
            [DEFAULT_TTS_OUTPUT_ID]: {
                id: DEFAULT_TTS_OUTPUT_ID,
                name: 'Output',
                class: 'Output',
                position: { x: 720, y: 0 },
                collapsed: false,
                inputs: {
                    content: {
                        sourceNode: DEFAULT_TTS_NODE_ID,
                        sourcePort: 0
                    }
                },
                inputValues: {}
            }
        }
    };
}

export function createDefaultSuggestionWorkflow(): WorkflowDefinition {
    const instructionId = 'suggestion_instruction';
    const agent: AgentNode = {
        id: DEFAULT_SUGGESTION_AGENT_ID,
        name: 'Suggester',
        class: 'Agent',
        position: { x: 0, y: 0 },
        collapsed: false,
        llmType: 'chat',
        toolIds: [],
        promptBlocks: {
            [instructionId]: {
                id: instructionId,
                name: 'Suggestion Instruction',
                type: 'message',
                role: 'user',
                content:
                    'Based on the conversation so far, suggest what the user might want to say next. Return only the suggested message.\n\n{{source}}',
                sortOrder: 'a0',
                enabled: true
            }
        },
        maxContext: 60000,
        maxResponse: 6000,
        lorebookRatio: 0.2,
        memoryRatio: 0.2,
        lorebookScanDepth: 5,
        slotNames: {},
        inputs: { stream: null },
        inputValues: { stream: true }
    };

    return {
        nodes: {
            [agent.id]: agent,
            [DEFAULT_SUGGESTION_OUTPUT_ID]: {
                id: DEFAULT_SUGGESTION_OUTPUT_ID,
                name: 'Output',
                class: 'Output',
                position: { x: 360, y: 0 },
                collapsed: false,
                inputs: {
                    content: {
                        sourceNode: agent.id,
                        sourcePort: 0
                    }
                },
                inputValues: {}
            }
        }
    };
}
