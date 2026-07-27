import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowRuntime, type WorkflowDefinition } from '$lib/workflow';
import type { LLMMessage } from '$lib/llm/types';
import { getTextContent } from '$lib/workflow/agent/llm';
import type { PagedMessages } from '$lib/services/content/paged_messages';
import type { Chat } from '$lib/services';

const {
    mockSelectLLMHandler,
    mockResolveLLM,
    mockTokenCount,
    mockGetChat,
    mockCreateChatInlay,
    mockToolCreate,
    mockToolUpdate,
    mockToolGet,
    mockReadWorkflowFile,
    mockWriteWorkflowFile,
    mockAppConfirm
} = vi.hoisted(() => ({
    mockSelectLLMHandler: vi.fn(),
    mockResolveLLM: vi.fn(),
    mockTokenCount: vi.fn(),
    mockGetChat: vi.fn(),
    mockCreateChatInlay: vi.fn(),
    mockToolCreate: vi.fn(),
    mockToolUpdate: vi.fn(),
    mockToolGet: vi.fn(),
    mockReadWorkflowFile: vi.fn(),
    mockWriteWorkflowFile: vi.fn(),
    mockAppConfirm: vi.fn()
}));

let toolRecord: Record<string, unknown> | null = null;

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
    return { ...original, getChat: mockGetChat, createChatInlay: mockCreateChatInlay };
});

vi.mock('$lib/stores/content/merged', () => ({
    getMergedLorebooks: vi.fn().mockResolvedValue([])
}));

vi.mock('$lib/managers/llm', () => ({
    resolveLLM: async (type: string, presetId?: string) => {
        mockResolveLLM(type, presetId);
        const selected = mockSelectLLMHandler();
        return {
            tokenizer: 'o200k_base',
            stream: selected.handler.stream
        };
    }
}));

vi.mock('$lib/llm/tokenizer', () => ({
    TokenCounter: {
        count: mockTokenCount
    }
}));

vi.mock('$lib/services/content/tool', () => ({
    ToolCallService: {
        create: mockToolCreate,
        update: mockToolUpdate,
        get: mockToolGet
    }
}));

vi.mock('$lib/workflow/file/operations', () => ({
    readWorkflowFile: mockReadWorkflowFile,
    writeWorkflowFile: mockWriteWorkflowFile,
    normalizeWorkflowFilePath: (path: string) => path.trim()
}));

vi.mock('$lib/ui', () => ({ appConfirm: mockAppConfirm }));

describe('executeAgentNode', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetChat.mockResolvedValue(stubChat);
        mockCreateChatInlay.mockResolvedValue({
            id: 'generated-inlay-1',
            sortOrder: 'a',
            name: 'generated-1.png',
            hash: 'generated-hash',
            encKey: 'generated-key',
            mimeType: 'image/png'
        });
        mockTokenCount.mockImplementation(async (text: string) => text.length);
        toolRecord = null;
        mockToolCreate.mockImplementation(async (chatId, fields) => {
            toolRecord = { ...fields, id: 'tool-record-1', chatId };
            return toolRecord;
        });
        mockToolUpdate.mockImplementation(async (_id, changes) => {
            toolRecord = { ...toolRecord, ...changes };
            return toolRecord;
        });
        mockToolGet.mockImplementation(async () => toolRecord);
        mockReadWorkflowFile.mockResolvedValue({
            id: 'file-1',
            path: 'notes.txt',
            content: 'hello from file',
            sortOrder: 'a'
        });
        mockAppConfirm.mockResolvedValue(true);
    });

    it('builds a prompt from slots and streams serialized LLM output', async () => {
        let receivedPrompt: LLMMessage[] = [];
        mockSelectLLMHandler.mockReturnValue({
            handler: {
                stream: vi.fn(async function* (prompt: LLMMessage[]) {
                    receivedPrompt = prompt;
                    yield {
                        parts: [
                            { type: 'thought', text: 'thinking' },
                            {
                                type: 'text',
                                text: `result: ${prompt[0] ? getTextContent(prompt[0].content) : ''}`
                            }
                        ]
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
                    collapsed: false,
                    content: '<|thought|>source thought<|/thought|>hello {{slot::missing}}',
                    inputs: {},
                    inputValues: {}
                },
                agent: {
                    id: 'agent',
                    name: 'Agent',
                    class: 'Agent',
                    position: { x: 0, y: 0 },
                    collapsed: false,
                    llmType: 'chat',
                    toolIds: [],
                    maxContext: 1000,
                    maxResponse: 100,
                    lorebookRatio: 0.2,
                    memoryRatio: 0.2,
                    lorebookScanDepth: 0,
                    promptBlocks: {
                        instruction: {
                            id: 'instruction',
                            name: 'Instruction',
                            type: 'message',
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
                    collapsed: false,
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
        ).resolves.toBe('<|thought|>thinking<|/thought|>result: Say hello {{slot::missing}}');

        expect(receivedPrompt).toEqual([
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'Say ' },
                    { type: 'thought', text: 'source thought' },
                    { type: 'text', text: 'hello {{slot::missing}}' }
                ]
            }
        ]);
        expect(mockResolveLLM).toHaveBeenCalledWith('chat', 'preset-1');
    });

    it('requires named slot macros for agent inputs', async () => {
        let receivedPrompt: LLMMessage[] = [];
        mockSelectLLMHandler.mockReturnValue({
            handler: {
                stream: vi.fn(async function* (prompt: LLMMessage[]) {
                    receivedPrompt = prompt;
                    yield {
                        parts: [
                            {
                                type: 'text',
                                text: `result: ${prompt[0] ? getTextContent(prompt[0].content) : ''}`
                            }
                        ]
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
                    collapsed: false,
                    content: 'hello',
                    inputs: {},
                    inputValues: {}
                },
                agent: {
                    id: 'agent',
                    name: 'Agent',
                    class: 'Agent',
                    position: { x: 0, y: 0 },
                    collapsed: false,
                    llmType: 'chat',
                    toolIds: [],
                    maxContext: 1000,
                    maxResponse: 100,
                    lorebookRatio: 0.2,
                    memoryRatio: 0.2,
                    lorebookScanDepth: 0,
                    promptBlocks: {
                        instruction: {
                            id: 'instruction',
                            name: 'Instruction',
                            type: 'message',
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
                    collapsed: false,
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
                    yield { parts: [{ type: 'text', text: 'memory saved' }] };
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
                    collapsed: false,
                    content: 'chat output',
                    inputs: {},
                    inputValues: {}
                },
                memory: {
                    id: 'memory',
                    name: 'Memory',
                    class: 'Agent',
                    position: { x: 0, y: 0 },
                    collapsed: false,
                    llmType: 'chat',
                    toolIds: [],
                    maxContext: 1000,
                    maxResponse: 100,
                    lorebookRatio: 0.2,
                    memoryRatio: 0.2,
                    lorebookScanDepth: 0,
                    promptBlocks: {
                        instruction: {
                            id: 'instruction',
                            name: 'Instruction',
                            type: 'message',
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
                // Sink drives the detached Agent's execution without emitting runtime output.
                memorySink: {
                    id: 'memorySink',
                    name: 'Memory Sink',
                    class: 'Sink',
                    position: { x: 0, y: 0 },
                    collapsed: false,
                    inputs: { content: { sourceNode: 'memory', sourcePort: 0 } },
                    inputValues: { content: '' }
                },
                output: {
                    id: 'output',
                    name: 'Output',
                    class: 'Output',
                    position: { x: 0, y: 0 },
                    collapsed: false,
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
                    yield { parts: [{ type: 'text', text: 'He' }] };
                    yield { parts: [{ type: 'text', text: 'Hello' }] };
                    yield { parts: [{ type: 'text', text: 'Hello!' }] };
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
                    collapsed: false,
                    llmType: 'chat',
                    toolIds: [],
                    maxContext: 1000,
                    maxResponse: 100,
                    lorebookRatio: 0.2,
                    memoryRatio: 0.2,
                    lorebookScanDepth: 0,
                    promptBlocks: {
                        instruction: {
                            id: 'instruction',
                            name: 'Instruction',
                            type: 'message',
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
                    collapsed: false,
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

    it('stores generated media as inlays and preserves response part order', async () => {
        mockSelectLLMHandler.mockReturnValue({
            handler: {
                stream: vi.fn(async function* () {
                    yield {
                        parts: [
                            { type: 'text' as const, text: 'Before' },
                            {
                                type: 'image' as const,
                                mimeType: 'image/png',
                                data: 'AQID'
                            },
                            { type: 'text' as const, text: 'After' }
                        ]
                    };
                })
            },
            unsupported: []
        });

        const result = await collectFinal(
            new WorkflowRuntime(createSimpleAgentWorkflow(), {
                ctx: { presetId: 'preset-1', chatId: 'chat-1' },
                messages: {} as PagedMessages
            }).run()
        );

        expect(result).toBe('Before<|inlay|>["generated-inlay-1"]<|/inlay|>After');
        expect(mockCreateChatInlay).toHaveBeenCalledWith(
            'chat-1',
            expect.objectContaining({ name: 'generated-1.png', type: 'image/png' })
        );
    });

    it('emits pending, running, and success states while executing a read tool', async () => {
        let requestCount = 0;
        const stream = vi.fn(async function* (
            _prompt: LLMMessage[],
            _signal: AbortSignal,
            options: { tools?: Array<{ name: string }> }
        ) {
            requestCount += 1;
            if (requestCount === 1) {
                expect(options.tools?.map((tool) => tool.name)).toEqual(['file_read']);
                yield {
                    parts: [
                        {
                            type: 'tool_request',
                            callId: 'provider-call-1',
                            name: 'file_read',
                            args: { namespace: 'chat', path: 'notes.txt' }
                        }
                    ]
                };
                return;
            }
            yield { parts: [{ type: 'text', text: 'Finished.' }] };
        });
        mockSelectLLMHandler.mockReturnValue({ handler: { stream }, unsupported: [] });

        const workflow = createToolWorkflow('file_read');
        const values: string[] = [];
        for await (const value of new WorkflowRuntime(workflow, {
            ctx: { presetId: 'preset-1', chatId: 'chat-1' },
            messages: {} as PagedMessages
        }).run()) {
            values.push(value);
        }

        expect(values).toContain(
            '<|tool_calls|>[{"id":"tool-record-1","name":"file_read","status":"pending"}]<|/tool_calls|>'
        );
        expect(values).toContain(
            '<|tool_calls|>[{"id":"tool-record-1","name":"file_read","status":"running"}]<|/tool_calls|>'
        );
        expect(values).toContain(
            '<|tool_calls|>[{"id":"tool-record-1","name":"file_read","status":"success"}]<|/tool_calls|>'
        );
        expect(values.at(-1)).toBe(
            '<|tool_calls|>[{"id":"tool-record-1","name":"file_read","status":"success"}]<|/tool_calls|>Finished.'
        );
        expect(mockReadWorkflowFile).toHaveBeenCalledWith(
            'chat',
            'notes.txt',
            expect.objectContaining({ chatId: 'chat-1' })
        );
    });

    it('keeps parallel tool requests and responses in one batch', async () => {
        const records = new Map<string, Record<string, unknown>>();
        let recordIndex = 0;
        mockToolCreate.mockImplementation(async (chatId, fields) => {
            const id = `tool-record-${++recordIndex}`;
            const record = { ...fields, id, chatId };
            records.set(id, record);
            return record;
        });
        mockToolUpdate.mockImplementation(async (id: string, changes) => {
            const record = { ...records.get(id), ...changes };
            records.set(id, record);
            return record;
        });
        mockToolGet.mockImplementation(async (id: string) => records.get(id) ?? null);

        let requestCount = 0;
        let followupPrompt: LLMMessage[] = [];
        mockSelectLLMHandler.mockReturnValue({
            handler: {
                stream: vi.fn(async function* (prompt: LLMMessage[]) {
                    requestCount += 1;
                    if (requestCount === 1) {
                        yield {
                            parts: [
                                {
                                    type: 'tool_request',
                                    callId: 'provider-call-1',
                                    name: 'file_read',
                                    args: { namespace: 'chat', path: 'one.txt' }
                                },
                                {
                                    type: 'tool_request',
                                    callId: 'provider-call-2',
                                    name: 'file_read',
                                    args: { namespace: 'chat', path: 'two.txt' }
                                }
                            ]
                        };
                        return;
                    }
                    followupPrompt = prompt;
                    yield { parts: [{ type: 'text', text: 'Finished.' }] };
                })
            },
            unsupported: []
        });

        const values: string[] = [];
        for await (const value of new WorkflowRuntime(createToolWorkflow('file_read'), {
            ctx: { presetId: 'preset-1', chatId: 'chat-1' },
            messages: {} as PagedMessages
        }).run()) {
            values.push(value);
        }

        expect(values).toContain(
            '<|tool_calls|>[{"id":"tool-record-1","name":"file_read","status":"pending"},{"id":"tool-record-2","name":"file_read","status":"pending"}]<|/tool_calls|>'
        );
        expect(followupPrompt.slice(-2)).toEqual([
            {
                role: 'assistant',
                content: [
                    {
                        type: 'tool_request',
                        callId: 'provider-call-1',
                        name: 'file_read',
                        args: { namespace: 'chat', path: 'one.txt' }
                    },
                    {
                        type: 'tool_request',
                        callId: 'provider-call-2',
                        name: 'file_read',
                        args: { namespace: 'chat', path: 'two.txt' }
                    }
                ]
            },
            {
                role: 'user',
                content: [
                    {
                        type: 'tool_response',
                        callId: 'provider-call-1',
                        name: 'file_read',
                        content: expect.any(Array)
                    },
                    {
                        type: 'tool_response',
                        callId: 'provider-call-2',
                        name: 'file_read',
                        content: expect.any(Array)
                    }
                ]
            }
        ]);
    });

    it('emits rejected for a denied write tool without executing it', async () => {
        let requestCount = 0;
        mockAppConfirm.mockResolvedValue(false);
        mockSelectLLMHandler.mockReturnValue({
            handler: {
                stream: vi.fn(async function* () {
                    requestCount += 1;
                    if (requestCount === 1) {
                        yield {
                            parts: [
                                {
                                    type: 'tool_request',
                                    callId: 'provider-call-1',
                                    name: 'file_write',
                                    args: {
                                        namespace: 'chat',
                                        path: 'notes.txt',
                                        content: 'new text'
                                    }
                                }
                            ]
                        };
                        return;
                    }
                    yield { parts: [{ type: 'text', text: 'Write cancelled.' }] };
                })
            },
            unsupported: []
        });

        const values: string[] = [];
        for await (const value of new WorkflowRuntime(createToolWorkflow('file_write'), {
            ctx: { presetId: 'preset-1', chatId: 'chat-1' },
            messages: {} as PagedMessages
        }).run()) {
            values.push(value);
        }

        expect(values).toContain(
            '<|tool_calls|>[{"id":"tool-record-1","name":"file_write","status":"pending"}]<|/tool_calls|>'
        );
        expect(values).toContain(
            '<|tool_calls|>[{"id":"tool-record-1","name":"file_write","status":"rejected"}]<|/tool_calls|>'
        );
        expect(mockAppConfirm).toHaveBeenCalledWith(
            {
                title: 'Allow File Write?',
                description:
                    'Agent wants to write a file\n\nTarget\nchat:notes.txt\n\nContent preview\nnew text',
                confirmText: 'Allow',
                cancelText: "Don't allow"
            },
            expect.any(AbortSignal)
        );
        expect(mockWriteWorkflowFile).not.toHaveBeenCalled();
    });
});

function createToolWorkflow(toolId: 'file_read' | 'file_write'): WorkflowDefinition {
    return {
        nodes: {
            agent: {
                id: 'agent',
                name: 'Agent',
                class: 'Agent',
                position: { x: 0, y: 0 },
                collapsed: false,
                llmType: 'chat',
                toolIds: [toolId],
                maxContext: 1000,
                maxResponse: 100,
                lorebookRatio: 0.2,
                memoryRatio: 0.2,
                lorebookScanDepth: 0,
                promptBlocks: {
                    instruction: {
                        id: 'instruction',
                        name: 'Instruction',
                        type: 'message',
                        role: 'user',
                        content: 'Use a tool',
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
                collapsed: false,
                inputs: { content: { sourceNode: 'agent', sourcePort: 0 } },
                inputValues: {}
            }
        }
    };
}

function createSimpleAgentWorkflow(): WorkflowDefinition {
    return {
        nodes: {
            agent: {
                id: 'agent',
                name: 'Agent',
                class: 'Agent',
                position: { x: 0, y: 0 },
                collapsed: false,
                llmType: 'chat',
                toolIds: [],
                maxContext: 1000,
                maxResponse: 100,
                lorebookRatio: 0.2,
                memoryRatio: 0.2,
                lorebookScanDepth: 0,
                promptBlocks: {
                    instruction: {
                        id: 'instruction',
                        name: 'Instruction',
                        type: 'message',
                        role: 'user',
                        content: 'Generate media',
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
                collapsed: false,
                inputs: {
                    content: { sourceNode: 'agent', sourcePort: 0 }
                },
                inputValues: {}
            }
        }
    };
}

async function collectFinal(stream: AsyncIterable<string>): Promise<string> {
    let final = '';
    for await (const value of stream) {
        final = value;
    }
    return final;
}
