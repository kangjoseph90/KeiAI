import type { AgentNode, PromptBlock, WorkflowDefinition } from './types';

export const DEFAULT_CHAT_AGENT_ID = 'chat_agent';
export const DEFAULT_CHAT_OUTPUT_ID = 'output';

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
        llmType: 'chat',
        promptBlocks: options.promptBlocks ?? {},
        maxContext: options.maxContext ?? 60000,
        maxResponse: options.maxResponse ?? 6000,
        lorebookRatio: options.lorebookRatio ?? 0.2,
        memoryRatio: options.memoryRatio ?? 0.2,
        lorebookScanDepth: options.lorebookScanDepth ?? 5,
        inputs: {}
    };

    return {
        nodes: {
            [agent.id]: agent,
            [DEFAULT_CHAT_OUTPUT_ID]: {
                id: DEFAULT_CHAT_OUTPUT_ID,
                name: 'Output',
                class: 'Output',
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

export function getFirstAgentNode(workflow: WorkflowDefinition): AgentNode | null {
    for (const node of Object.values(workflow.nodes)) {
        if (node.class === 'Agent') return node;
    }
    return null;
}
