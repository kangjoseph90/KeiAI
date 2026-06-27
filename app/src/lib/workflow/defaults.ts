import type { AgentNode, PromptBlock, WorkflowDefinition } from './types';

export const DEFAULT_CHAT_AGENT_ID = 'chat_agent';
export const DEFAULT_CHAT_OUTPUT_ID = 'output';
export const DEFAULT_TRANSLATION_AGENT_ID = 'translation_agent';
export const DEFAULT_TRANSLATION_OUTPUT_ID = 'translation_output';

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
        llmType: 'chat',
        promptBlocks: options.promptBlocks ?? {},
        maxContext: options.maxContext ?? 60000,
        maxResponse: options.maxResponse ?? 6000,
        lorebookRatio: options.lorebookRatio ?? 0.2,
        memoryRatio: options.memoryRatio ?? 0.2,
        lorebookScanDepth: options.lorebookScanDepth ?? 5,
        slotNames: {},
        inputs: {}
    };

    return {
        nodes: {
            [agent.id]: agent,
            [DEFAULT_CHAT_OUTPUT_ID]: {
                id: DEFAULT_CHAT_OUTPUT_ID,
                name: 'Output',
                class: 'Output',
                position: { x: 360, y: 0 },
                inputs: {
                    content: {
                        sourceNode: agent.id,
                        sourcePort: 0
                    }
                }
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
        llmType: 'translation',
        promptBlocks: {
            [instructionId]: {
                id: instructionId,
                name: 'Translation Instruction',
                type: 'text',
                role: 'user',
                content:
                    'Translate the following text into {{targetlang}}. Return only the translated text.\n\n{{source}}',
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
        inputs: {}
    };

    return {
        nodes: {
            [agent.id]: agent,
            [DEFAULT_TRANSLATION_OUTPUT_ID]: {
                id: DEFAULT_TRANSLATION_OUTPUT_ID,
                name: 'Output',
                class: 'Output',
                position: { x: 360, y: 0 },
                inputs: {
                    content: {
                        sourceNode: agent.id,
                        sourcePort: 0
                    }
                }
            }
        }
    };
}
