import { describe, expect, it } from 'vitest';
import { WorkflowRuntime, type WorkflowDefinition, type WorkflowRunEvent } from '$lib/workflow';

describe('WorkflowRuntime', () => {
    it('runs string nodes through concat and output', async () => {
        const workflow: WorkflowDefinition = {
            nodes: {
                hello: {
                    id: 'hello',
                    name: 'Hello',
                    class: 'String',
                    position: { x: 0, y: 0 },
                    content: 'hello',
                    inputs: {}
                },
                world: {
                    id: 'world',
                    name: 'World',
                    class: 'String',
                    position: { x: 0, y: 0 },
                    content: 'world',
                    inputs: {}
                },
                concat: {
                    id: 'concat',
                    name: 'Concat',
                    class: 'Concat',
                    position: { x: 0, y: 0 },
                    separator: ' ',
                    inputs: {
                        a: { sourceNode: 'hello', sourcePort: 0 },
                        b: { sourceNode: 'world', sourcePort: 0 }
                    }
                },
                output: {
                    id: 'output',
                    name: 'Output',
                    class: 'Output',
                    position: { x: 0, y: 0 },
                    inputs: {
                        content: { sourceNode: 'concat', sourcePort: 0 }
                    }
                }
            }
        };

        await expect(collectFinal(new WorkflowRuntime(workflow).run())).resolves.toBe(
            'hello world'
        );
    });

    it('runs a shared upstream node once for fan-out before the single output', async () => {
        const events: WorkflowRunEvent[] = [];
        const workflow: WorkflowDefinition = {
            nodes: {
                source: {
                    id: 'source',
                    name: 'Source',
                    class: 'String',
                    position: { x: 0, y: 0 },
                    content: 'shared',
                    inputs: {}
                },
                left: {
                    id: 'left',
                    name: 'Left',
                    class: 'Concat',
                    position: { x: 0, y: 0 },
                    separator: '',
                    inputs: {
                        content: { sourceNode: 'source', sourcePort: 0 }
                    }
                },
                right: {
                    id: 'right',
                    name: 'Right',
                    class: 'Concat',
                    position: { x: 0, y: 0 },
                    separator: '',
                    inputs: {
                        content: { sourceNode: 'source', sourcePort: 0 }
                    }
                },
                output: {
                    id: 'output',
                    name: 'Output',
                    class: 'Output',
                    position: { x: 0, y: 0 },
                    inputs: {
                        a: { sourceNode: 'left', sourcePort: 0 },
                        b: { sourceNode: 'right', sourcePort: 0 }
                    }
                }
            }
        };
        const runtime = new WorkflowRuntime(workflow, {
            onEvent: (event) => events.push(event)
        });

        await expect(runtime.runNode('output')).resolves.toBe('shared');

        expect(
            events.filter((event) => event.type === 'nodeStart' && event.nodeId === 'source')
        ).toHaveLength(1);
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
                    inputs: {}
                },
                output: {
                    id: 'output',
                    name: 'Output',
                    class: 'Output',
                    position: { x: 0, y: 0 },
                    inputs: {
                        content: { sourceNode: 'source', sourcePort: 0 }
                    }
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
                    separator: '',
                    inputs: {
                        value: { sourceNode: 'b', sourcePort: 0 }
                    }
                },
                b: {
                    id: 'b',
                    name: 'B',
                    class: 'Concat',
                    position: { x: 0, y: 0 },
                    separator: '',
                    inputs: {
                        value: { sourceNode: 'a', sourcePort: 0 }
                    }
                },
                output: {
                    id: 'output',
                    name: 'Output',
                    class: 'Output',
                    position: { x: 0, y: 0 },
                    inputs: {
                        content: { sourceNode: 'a', sourcePort: 0 }
                    }
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
                    }
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
                    inputs: {}
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
                    inputs: {}
                },
                first: {
                    id: 'first',
                    name: 'First',
                    class: 'Output',
                    position: { x: 0, y: 0 },
                    inputs: {
                        content: { sourceNode: 'source', sourcePort: 0 }
                    }
                },
                second: {
                    id: 'second',
                    name: 'Second',
                    class: 'Output',
                    position: { x: 0, y: 0 },
                    inputs: {
                        content: { sourceNode: 'source', sourcePort: 0 }
                    }
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
});

async function collectFinal(stream: AsyncIterable<{ content: string }>): Promise<string> {
    let final = '';
    for await (const state of stream) {
        final = state.content;
    }
    return final;
}
