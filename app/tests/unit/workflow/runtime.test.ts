import { describe, expect, it } from 'vitest';
import { WorkflowRuntime, type WorkflowDefinition } from '$lib/workflow';

describe('WorkflowRuntime', () => {
    it('uses literal input values and lets connected edges take precedence', async () => {
        const workflow: WorkflowDefinition = {
            nodes: {
                source: {
                    id: 'source',
                    name: 'Source',
                    class: 'String',
                    position: { x: 0, y: 0 },
                    content: 'edge',
                    inputs: {},
                    inputValues: {}
                },
                concat: {
                    id: 'concat',
                    name: 'Concat',
                    class: 'Concat',
                    position: { x: 0, y: 0 },
                    inputs: {
                        a: { sourceNode: 'source', sourcePort: 0 },
                        b: null,
                        separator: null
                    },
                    inputValues: { a: 'stored literal', b: 'literal', separator: ':' }
                },
                output: {
                    id: 'output',
                    name: 'Output',
                    class: 'Output',
                    position: { x: 0, y: 0 },
                    inputs: { content: { sourceNode: 'concat', sourcePort: 0 } },
                    inputValues: {}
                }
            }
        };

        await expect(collectFinal(new WorkflowRuntime(workflow).run())).resolves.toBe(
            'edge:literal'
        );
    });

    it('runs string nodes through concat and output', async () => {
        const workflow: WorkflowDefinition = {
            nodes: {
                hello: {
                    id: 'hello',
                    name: 'Hello',
                    class: 'String',
                    position: { x: 0, y: 0 },
                    content: 'hello',
                    inputs: {},
                    inputValues: {}
                },
                world: {
                    id: 'world',
                    name: 'World',
                    class: 'String',
                    position: { x: 0, y: 0 },
                    content: 'world',
                    inputs: {},
                    inputValues: {}
                },
                concat: {
                    id: 'concat',
                    name: 'Concat',
                    class: 'Concat',
                    position: { x: 0, y: 0 },
                    inputs: {
                        a: { sourceNode: 'hello', sourcePort: 0 },
                        b: { sourceNode: 'world', sourcePort: 0 },
                        separator: null
                    },
                    inputValues: { a: '', b: '', separator: ' ' }
                },
                output: {
                    id: 'output',
                    name: 'Output',
                    class: 'Output',
                    position: { x: 0, y: 0 },
                    inputs: {
                        content: { sourceNode: 'concat', sourcePort: 0 }
                    },
                    inputValues: {}
                }
            }
        };

        await expect(collectFinal(new WorkflowRuntime(workflow).run())).resolves.toBe(
            'hello world'
        );
    });

    it('shares an upstream node across fan-out paths', async () => {
        const workflow: WorkflowDefinition = {
            nodes: {
                source: {
                    id: 'source',
                    name: 'Source',
                    class: 'String',
                    position: { x: 0, y: 0 },
                    content: 'shared',
                    inputs: {},
                    inputValues: {}
                },
                left: {
                    id: 'left',
                    name: 'Left',
                    class: 'Concat',
                    position: { x: 0, y: 0 },
                    inputs: {
                        a: { sourceNode: 'source', sourcePort: 0 },
                        b: null,
                        separator: null
                    },
                    inputValues: { a: '', b: '', separator: '' }
                },
                right: {
                    id: 'right',
                    name: 'Right',
                    class: 'Concat',
                    position: { x: 0, y: 0 },
                    inputs: {
                        a: { sourceNode: 'source', sourcePort: 0 },
                        b: null,
                        separator: null
                    },
                    inputValues: { a: '', b: '', separator: '' }
                },
                output: {
                    id: 'output',
                    name: 'Output',
                    class: 'Output',
                    position: { x: 0, y: 0 },
                    inputs: {
                        content: { sourceNode: 'left', sourcePort: 0 }
                    },
                    inputValues: {}
                }
            }
        };
        const runtime = new WorkflowRuntime(workflow);

        await expect(collectFinal(runtime.run())).resolves.toBe('shared');
    });

    it('passes local macros to node executors without final re-rendering', async () => {
        const workflow: WorkflowDefinition = {
            nodes: {
                source: {
                    id: 'source',
                    name: 'Source',
                    class: 'String',
                    position: { x: 0, y: 0 },
                    content: 'Translate to {{targetlang}}',
                    inputs: {},
                    inputValues: {}
                },
                output: {
                    id: 'output',
                    name: 'Output',
                    class: 'Output',
                    position: { x: 0, y: 0 },
                    inputs: {
                        content: { sourceNode: 'source', sourcePort: 0 }
                    },
                    inputValues: {}
                }
            }
        };
        const runtime = new WorkflowRuntime(workflow, {
            localMacros: new Map([
                [
                    'targetlang',
                    {
                        run: () => 'Korean'
                    }
                ]
            ])
        });

        // The runtime no longer renders templates on node output — that is the
        // task runner's responsibility, where the correct context is available.
        await expect(collectFinal(runtime.run())).resolves.toBe('Translate to {{targetlang}}');
    });

    it('rejects cyclic graphs before running', () => {
        const workflow: WorkflowDefinition = {
            nodes: {
                a: {
                    id: 'a',
                    name: 'A',
                    class: 'Concat',
                    position: { x: 0, y: 0 },
                    inputs: {
                        a: { sourceNode: 'b', sourcePort: 0 },
                        b: null,
                        separator: null
                    },
                    inputValues: { a: '', b: '', separator: '' }
                },
                b: {
                    id: 'b',
                    name: 'B',
                    class: 'Concat',
                    position: { x: 0, y: 0 },
                    inputs: {
                        a: { sourceNode: 'a', sourcePort: 0 },
                        b: null,
                        separator: null
                    },
                    inputValues: { a: '', b: '', separator: '' }
                },
                output: {
                    id: 'output',
                    name: 'Output',
                    class: 'Output',
                    position: { x: 0, y: 0 },
                    inputs: {
                        content: { sourceNode: 'a', sourcePort: 0 }
                    },
                    inputValues: {}
                }
            }
        };

        expect(() => new WorkflowRuntime(workflow)).toThrow(
            'Workflow graph has a cycle: a -> b -> a'
        );
    });

    it('rejects missing source nodes before running', () => {
        const workflow: WorkflowDefinition = {
            nodes: {
                output: {
                    id: 'output',
                    name: 'Output',
                    class: 'Output',
                    position: { x: 0, y: 0 },
                    inputs: {
                        content: { sourceNode: 'missing', sourcePort: 0 }
                    },
                    inputValues: {}
                }
            }
        };

        expect(() => new WorkflowRuntime(workflow)).toThrow('Workflow node not found: missing');
    });

    it('rejects workflows without exactly one output', () => {
        const noOutput: WorkflowDefinition = {
            nodes: {
                source: {
                    id: 'source',
                    name: 'Source',
                    class: 'String',
                    position: { x: 0, y: 0 },
                    content: 'text',
                    inputs: {},
                    inputValues: {}
                }
            }
        };
        const twoOutputs: WorkflowDefinition = {
            nodes: {
                source: {
                    id: 'source',
                    name: 'Source',
                    class: 'String',
                    position: { x: 0, y: 0 },
                    content: 'text',
                    inputs: {},
                    inputValues: {}
                },
                first: {
                    id: 'first',
                    name: 'First',
                    class: 'Output',
                    position: { x: 0, y: 0 },
                    inputs: {
                        content: { sourceNode: 'source', sourcePort: 0 }
                    },
                    inputValues: {}
                },
                second: {
                    id: 'second',
                    name: 'Second',
                    class: 'Output',
                    position: { x: 0, y: 0 },
                    inputs: {
                        content: { sourceNode: 'source', sourcePort: 0 }
                    },
                    inputValues: {}
                }
            }
        };

        expect(() => new WorkflowRuntime(noOutput)).toThrow(
            'Workflow must have exactly one Output node, found 0'
        );
        expect(() => new WorkflowRuntime(twoOutputs)).toThrow(
            'Workflow must have exactly one Output node, found 2'
        );
    });

    it('rejects an Output node without content', async () => {
        const workflow: WorkflowDefinition = {
            nodes: {
                output: {
                    id: 'output',
                    name: 'Output',
                    class: 'Output',
                    position: { x: 0, y: 0 },
                    inputs: { content: null },
                    inputValues: {}
                }
            }
        };

        await expect(collectFinal(new WorkflowRuntime(workflow).run())).rejects.toThrow(
            'Output content input is required: output'
        );
    });
});

async function collectFinal(stream: AsyncIterable<{ content: string }>): Promise<string> {
    let final = '';
    for await (const state of stream) {
        final = state.content;
    }
    return final;
}
