import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowRuntime, type WorkflowDefinition } from '$lib/workflow';
import { getTextContent, type LLMMessage } from '$lib/llm/types';
import type { PagedMessages } from '$lib/services/content/paged_messages';
import type { Chat } from '$lib/services';

const {
    mockSelectLLMHandler,
    mockResolveModelConfig,
    mockResolveParameters,
    mockGetSettings,
    mockTokenCount,
    mockGetChat
} = vi.hoisted(() => ({
    mockSelectLLMHandler: vi.fn(),
    mockResolveModelConfig: vi.fn(),
    mockResolveParameters: vi.fn(),
    mockGetSettings: vi.fn(),
    mockTokenCount: vi.fn(),
    mockGetChat: vi.fn()
}));

const stubChat: Chat = {
    id: 'chat-1',
    roomId: 'room-1',
    scopeType: 'user',
    scopeId: 'user-1',
    title: 'Test Chat',
    chatNote: '',
    messageCount: 0,
    personas: { refs: {}, folders: {} },
    lorebooks: { refs: {}, folders: {} },
    inlays: { refs: {}, folders: {} },
    files: { refs: {}, folders: {} }
};

vi.mock('$lib/stores', async (importOriginal) => {
    const original = await importOriginal<typeof import('$lib/stores')>();
    return { ...original, getChat: mockGetChat };
});

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
        mockGetChat.mockResolvedValue(stubChat);
        mockTokenCount.mockImplementation(async (text: string) => text.length);
    });

    it('builds a prompt from slots and streams serialized LLM output', async () => {
        let receivedPrompt: LLMMessage[] = [];
        mockSelectLLMHandler.mockReturnValue({
            handler: {
                stream: vi.fn(async function* (prompt: LLMMessage[]) {
                    receivedPrompt = prompt;
                    yield {
                        thought: 'thinking',
                        content: `result: ${prompt[0] ? getTextContent(prompt[0].content) : ''}`
                    };
                })
            },
            unsupported: []
        });

        const workflow: WorkflowDefinition = {
            nodes: {
                source: {
                    id: 'source',
                    name: 'Source',
                    class: 'String',
                    position: { x: 0, y: 0 },
                    content: 'hello',
                    inputs: {},
                    inputValues: {}
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
                    },
                    inputValues: { input_source: '' }
                },
                output: {
                    id: 'output',
                    name: 'Output',
                    class: 'Output',
                    position: { x: 0, y: 0 },
                    inputs: {
                        content: { sourceNode: 'agent', sourcePort: 0 }
                    },
                    inputValues: {}
                }
            }
        };

        await expect(
            collectFinal(
                new WorkflowRuntime(workflow, {
                    ctx: { presetId: 'preset-1', chatId: 'chat-1' },
                    messages: {} as PagedMessages
                }).run()
            )
        ).resolves.toBe('<|thought|>thinking<|/thought|>result: Say hello');

        expect(receivedPrompt).toEqual([
            { role: 'user', content: [{ type: 'text', text: 'Say hello' }] }
        ]);
        expect(mockResolveModelConfig).toHaveBeenCalledWith('chat', 'preset-1');
        expect(mockResolveParameters).toHaveBeenCalledWith('chat', 'preset-1');
    });

    it('requires named slot macros for agent inputs', async () => {
        let receivedPrompt: LLMMessage[] = [];
        mockSelectLLMHandler.mockReturnValue({
            handler: {
                stream: vi.fn(async function* (prompt: LLMMessage[]) {
                    receivedPrompt = prompt;
                    yield {
                        content: `result: ${prompt[0] ? getTextContent(prompt[0].content) : ''}`
                    };
                })
            },
            unsupported: []
        });

        const workflow: WorkflowDefinition = {
            nodes: {
                source: {
                    id: 'source',
                    name: 'Source',
                    class: 'String',
                    position: { x: 0, y: 0 },
                    content: 'hello',
                    inputs: {},
                    inputValues: {}
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
                    },
                    inputValues: { input_source: '' }
                },
                output: {
                    id: 'output',
                    name: 'Output',
                    class: 'Output',
                    position: { x: 0, y: 0 },
                    inputs: {
                        content: { sourceNode: 'agent', sourcePort: 0 }
                    },
                    inputValues: {}
                }
            }
        };

        await expect(
            collectFinal(
                new WorkflowRuntime(workflow, {
                    ctx: { presetId: 'preset-1', chatId: 'chat-1' },
                    messages: {} as PagedMessages
                }).run()
            )
        ).resolves.toBe('result: Say ERROR then hello');

        expect(receivedPrompt).toEqual([
            { role: 'user', content: [{ type: 'text', text: 'Say ERROR then hello' }] }
        ]);
    });

    it('keeps the Output iterator open until a detached Agent finishes', async () => {
        let releaseAgent: (() => void) | undefined;
        const agentGate = new Promise<void>((resolve) => {
            releaseAgent = resolve;
        });
        mockSelectLLMHandler.mockReturnValue({
            handler: {
                stream: vi.fn(async function* () {
                    await agentGate;
                    yield { content: 'memory saved' };
                })
            },
            unsupported: []
        });

        const workflow: WorkflowDefinition = {
            nodes: {
                visible: {
                    id: 'visible',
                    name: 'Visible',
                    class: 'String',
                    position: { x: 0, y: 0 },
                    content: 'chat output',
                    inputs: {},
                    inputValues: {}
                },
                memory: {
                    id: 'memory',
                    name: 'Memory',
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
                            content: 'Update memory',
                            sortOrder: 'a',
                            enabled: true
                        }
                    },
                    slotNames: {},
                    inputs: {},
                    inputValues: {}
                },
                output: {
                    id: 'output',
                    name: 'Output',
                    class: 'Output',
                    position: { x: 0, y: 0 },
                    inputs: { content: { sourceNode: 'visible', sourcePort: 0 } },
                    inputValues: {}
                }
            }
        };
        const iterator = new WorkflowRuntime(workflow, {
            ctx: { presetId: 'preset-1', chatId: 'chat-1' },
            messages: {} as PagedMessages
        })
            .run()
            [Symbol.asyncIterator]();

        await expect(iterator.next()).resolves.toEqual({
            done: false,
            value: 'chat output'
        });

        let completed = false;
        const completion = iterator.next().then((result) => {
            completed = true;
            return result;
        });
        await Promise.resolve();
        expect(completed).toBe(false);

        releaseAgent?.();
        await expect(completion).resolves.toEqual({ done: true, value: undefined });
    });

    it('streams every cumulative LLM chunk to Output in order', async () => {
        // Multi-token: mock LLM yields cumulative content ('He', 'Hello', 'Hello!').
        // Each chunk must reach run() as a separate value event, in order.
        mockSelectLLMHandler.mockReturnValue({
            handler: {
                stream: vi.fn(async function* () {
                    yield { content: 'He' };
                    yield { content: 'Hello' };
                    yield { content: 'Hello!' };
                })
            },
            unsupported: []
        });

        const workflow: WorkflowDefinition = {
            nodes: {
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
                            content: 'greet',
                            sortOrder: 'a',
                            enabled: true
                        }
                    },
                    slotNames: {},
                    inputs: {},
                    inputValues: {}
                },
                output: {
                    id: 'output',
                    name: 'Output',
                    class: 'Output',
                    position: { x: 0, y: 0 },
                    inputs: { content: { sourceNode: 'agent', sourcePort: 0 } },
                    inputValues: {}
                }
            }
        };

        const values: string[] = [];
        for await (const value of new WorkflowRuntime(workflow, {
            ctx: { presetId: 'preset-1', chatId: 'chat-1' },
            messages: {} as PagedMessages
        }).run()) {
            values.push(value);
        }
        expect(values).toEqual(['He', 'Hello', 'Hello!']);
    });
});

async function collectFinal(stream: AsyncIterable<string>): Promise<string> {
    let final = '';
    for await (const value of stream) {
        final = value;
    }
    return final;
}
