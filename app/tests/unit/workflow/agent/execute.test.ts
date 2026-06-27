import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowRuntime, type WorkflowDefinition } from '$lib/workflow';
import type { OpenAIChat } from '$lib/llm/types';
import type { PagedMessages } from '$lib/services/content/paged_messages';

const {
    mockSelectLLMHandler,
    mockResolveModelConfig,
    mockResolveParameters,
    mockGetSettings,
    mockTokenCount
} = vi.hoisted(() => ({
    mockSelectLLMHandler: vi.fn(),
    mockResolveModelConfig: vi.fn(),
    mockResolveParameters: vi.fn(),
    mockGetSettings: vi.fn(),
    mockTokenCount: vi.fn()
}));

vi.mock('$lib/stores/content/settings', () => ({
    getAppSettings: mockGetSettings
}));

vi.mock('$lib/stores/content/merged', () => ({
    getMergedLorebooks: vi.fn().mockResolvedValue([])
}));

vi.mock('$lib/llm/handler', () => ({
    resolveLLMModelConfig: mockResolveModelConfig,
    resolveLLMParameters: mockResolveParameters,
    selectLLMHandler: mockSelectLLMHandler
}));

vi.mock('$lib/llm/tokenizer', () => ({
    TokenCounter: {
        count: mockTokenCount
    }
}));

describe('executeAgentNode', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetSettings.mockResolvedValue({});
        mockResolveModelConfig.mockResolvedValue({
            id: 'mock::agent',
            provider: 'mock',
            tokenizer: 'o200k_base'
        });
        mockResolveParameters.mockResolvedValue({ temperature: 0.5 });
        mockTokenCount.mockImplementation(async (text: string) => text.length);
    });

    it('builds a prompt from slots and streams serialized LLM output', async () => {
        let receivedPrompt: OpenAIChat[] = [];
        mockSelectLLMHandler.mockReturnValue({
            stream: vi.fn(async function* (prompt: OpenAIChat[]) {
                receivedPrompt = prompt;
                yield {
                    thought: 'thinking',
                    content: `result: ${prompt[0]?.content ?? ''}`
                };
            })
        });

        const workflow: WorkflowDefinition = {
            nodes: {
                source: {
                    id: 'source',
                    name: 'Source',
                    class: 'String',
                    position: { x: 0, y: 0 },
                    content: 'hello',
                    inputs: {}
                },
                agent: {
                    id: 'agent',
                    name: 'Agent',
                    class: 'Agent',
                    position: { x: 0, y: 0 },
                    llmType: 'chat',
                    maxContext: 1000,
                    maxResponse: 100,
                    lorebookRatio: 0.2,
                    memoryRatio: 0.2,
                    lorebookScanDepth: 0,
                    promptBlocks: {
                        instruction: {
                            id: 'instruction',
                            name: 'Instruction',
                            type: 'text',
                            role: 'user',
                            content: 'Say {{slot::source}}',
                            sortOrder: 'a',
                            enabled: true
                        }
                    },
                    slotNames: {
                        input_source: 'source'
                    },
                    inputs: {
                        input_source: {
                            sourceNode: 'source',
                            sourcePort: 0
                        }
                    }
                },
                output: {
                    id: 'output',
                    name: 'Output',
                    class: 'Output',
                    position: { x: 0, y: 0 },
                    inputs: {
                        content: { sourceNode: 'agent', sourcePort: 0 }
                    }
                }
            }
        };

        await expect(
            collectFinal(
                new WorkflowRuntime(workflow, {
                    ctx: { presetId: 'preset-1' },
                    messages: {} as PagedMessages
                }).run()
            )
        ).resolves.toBe('<thought>\nthinking\n</thought>\n\nresult: Say hello');

        expect(receivedPrompt).toEqual([{ role: 'user', content: 'Say hello' }]);
        expect(mockResolveModelConfig).toHaveBeenCalledWith('chat', 'preset-1');
        expect(mockResolveParameters).toHaveBeenCalledWith('chat', 'preset-1');
    });

    it('requires named slot macros for agent inputs', async () => {
        let receivedPrompt: OpenAIChat[] = [];
        mockSelectLLMHandler.mockReturnValue({
            stream: vi.fn(async function* (prompt: OpenAIChat[]) {
                receivedPrompt = prompt;
                yield {
                    content: `result: ${prompt[0]?.content ?? ''}`
                };
            })
        });

        const workflow: WorkflowDefinition = {
            nodes: {
                source: {
                    id: 'source',
                    name: 'Source',
                    class: 'String',
                    position: { x: 0, y: 0 },
                    content: 'hello',
                    inputs: {}
                },
                agent: {
                    id: 'agent',
                    name: 'Agent',
                    class: 'Agent',
                    position: { x: 0, y: 0 },
                    llmType: 'chat',
                    maxContext: 1000,
                    maxResponse: 100,
                    lorebookRatio: 0.2,
                    memoryRatio: 0.2,
                    lorebookScanDepth: 0,
                    promptBlocks: {
                        instruction: {
                            id: 'instruction',
                            name: 'Instruction',
                            type: 'text',
                            role: 'user',
                            content: 'Say {{slot}} then {{slot::source}}',
                            sortOrder: 'a',
                            enabled: true
                        }
                    },
                    slotNames: {
                        input_source: 'source'
                    },
                    inputs: {
                        input_source: {
                            sourceNode: 'source',
                            sourcePort: 0
                        }
                    }
                },
                output: {
                    id: 'output',
                    name: 'Output',
                    class: 'Output',
                    position: { x: 0, y: 0 },
                    inputs: {
                        content: { sourceNode: 'agent', sourcePort: 0 }
                    }
                }
            }
        };

        await expect(
            collectFinal(
                new WorkflowRuntime(workflow, {
                    ctx: { presetId: 'preset-1' },
                    messages: {} as PagedMessages
                }).run()
            )
        ).resolves.toBe('result: Say ERROR then hello');

        expect(receivedPrompt).toEqual([{ role: 'user', content: 'Say ERROR then hello' }]);
    });
});

async function collectFinal(stream: AsyncIterable<{ content: string }>): Promise<string> {
    let final = '';
    for await (const state of stream) {
        final = state.content;
    }
    return final;
}
