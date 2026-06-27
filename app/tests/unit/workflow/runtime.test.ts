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

    it('coerces number and boolean outputs into string inputs', async () => {
        const numberWorkflow: WorkflowDefinition = {
            nodes: {
                count: {
                    id: 'count',
                    name: 'Count',
                    class: 'Number',
                    position: { x: 0, y: 0 },
                    value: 42,
                    inputs: {},
                    inputValues: {}
                },
                output: {
                    id: 'output',
                    name: 'Output',
                    class: 'Output',
                    position: { x: 0, y: 0 },
                    inputs: {
                        content: { sourceNode: 'count', sourcePort: 0 }
                    },
                    inputValues: {}
                }
            }
        };
        const booleanWorkflow: WorkflowDefinition = {
            nodes: {
                enabled: {
                    id: 'enabled',
                    name: 'Enabled',
                    class: 'Boolean',
                    position: { x: 0, y: 0 },
                    value: true,
                    inputs: {},
                    inputValues: {}
                },
                output: {
                    id: 'output',
                    name: 'Output',
                    class: 'Output',
                    position: { x: 0, y: 0 },
                    inputs: {
                        content: { sourceNode: 'enabled', sourcePort: 0 }
                    },
                    inputValues: {}
                }
            }
        };

        await expect(collectFinal(new WorkflowRuntime(numberWorkflow).run())).resolves.toBe('42');
        await expect(collectFinal(new WorkflowRuntime(booleanWorkflow).run())).resolves.toBe(
            'true'
        );
    });

    it('runs typed number and boolean operators', async () => {
        const workflow: WorkflowDefinition = {
            nodes: {
                value: {
                    id: 'value',
                    name: 'Value',
                    class: 'Number',
                    position: { x: 0, y: 0 },
                    value: 5,
                    inputs: {},
                    inputValues: {}
                },
                math: {
                    id: 'math',
                    name: 'Math',
                    class: 'NumberMath',
                    position: { x: 0, y: 0 },
                    operator: 'multiply',
                    inputs: {
                        a: { sourceNode: 'value', sourcePort: 0 },
                        b: null
                    },
                    inputValues: {
                        a: 0,
                        b: 3
                    }
                },
                compare: {
                    id: 'compare',
                    name: 'Compare',
                    class: 'NumberCompare',
                    position: { x: 0, y: 0 },
                    operator: 'greaterThan',
                    inputs: {
                        a: { sourceNode: 'math', sourcePort: 0 },
                        b: null
                    },
                    inputValues: {
                        a: 0,
                        b: 10
                    }
                },
                not: {
                    id: 'not',
                    name: 'Not',
                    class: 'BooleanNot',
                    position: { x: 0, y: 0 },
                    inputs: {
                        value: { sourceNode: 'compare', sourcePort: 0 }
                    },
                    inputValues: {
                        value: false
                    }
                },
                output: {
                    id: 'output',
                    name: 'Output',
                    class: 'Output',
                    position: { x: 0, y: 0 },
                    inputs: {
                        content: { sourceNode: 'not', sourcePort: 0 }
                    },
                    inputValues: {}
                }
            }
        };

        await expect(collectFinal(new WorkflowRuntime(workflow).run())).resolves.toBe('false');
    });

    it('runs extended boolean logic operators', async () => {
        const workflow: WorkflowDefinition = {
            nodes: {
                xor: {
                    id: 'xor',
                    name: 'Xor',
                    class: 'BooleanLogic',
                    position: { x: 0, y: 0 },
                    operator: 'xor',
                    inputs: {
                        a: null,
                        b: null
                    },
                    inputValues: {
                        a: true,
                        b: false
                    }
                },
                nor: {
                    id: 'nor',
                    name: 'Nor',
                    class: 'BooleanLogic',
                    position: { x: 0, y: 0 },
                    operator: 'nor',
                    inputs: {
                        a: { sourceNode: 'xor', sourcePort: 0 },
                        b: null
                    },
                    inputValues: {
                        a: false,
                        b: false
                    }
                },
                output: {
                    id: 'output',
                    name: 'Output',
                    class: 'Output',
                    position: { x: 0, y: 0 },
                    inputs: {
                        content: { sourceNode: 'nor', sourcePort: 0 }
                    },
                    inputValues: {}
                }
            }
        };

        await expect(collectFinal(new WorkflowRuntime(workflow).run())).resolves.toBe('false');
    });

    it('gates false into skip and ungates skip into false', async () => {
        const workflow: WorkflowDefinition = {
            nodes: {
                condition: {
                    id: 'condition',
                    name: 'Condition',
                    class: 'Boolean',
                    position: { x: 0, y: 0 },
                    value: false,
                    inputs: {},
                    inputValues: {}
                },
                gate: {
                    id: 'gate',
                    name: 'Gate',
                    class: 'Gate',
                    position: { x: 0, y: 0 },
                    inputs: {
                        condition: { sourceNode: 'condition', sourcePort: 0 }
                    },
                    inputValues: {
                        condition: false
                    }
                },
                ungate: {
                    id: 'ungate',
                    name: 'Ungate',
                    class: 'Ungate',
                    position: { x: 0, y: 0 },
                    inputs: {
                        condition: { sourceNode: 'gate', sourcePort: 0 }
                    },
                    inputValues: {
                        condition: false
                    }
                },
                output: {
                    id: 'output',
                    name: 'Output',
                    class: 'Output',
                    position: { x: 0, y: 0 },
                    inputs: {
                        content: { sourceNode: 'ungate', sourcePort: 0 }
                    },
                    inputValues: {}
                }
            }
        };

        await expect(collectFinal(new WorkflowRuntime(workflow).run())).resolves.toBe('false');
    });

    it('keeps side-path errors on their edge without failing a successful output', async () => {
        const workflow: WorkflowDefinition = {
            nodes: {
                ok: {
                    id: 'ok',
                    name: 'Ok',
                    class: 'String',
                    position: { x: 0, y: 0 },
                    content: 'ok',
                    inputs: {},
                    inputValues: {}
                },
                broken: {
                    id: 'broken',
                    name: 'Broken Side Path',
                    class: 'NumberMath',
                    position: { x: 0, y: 0 },
                    operator: 'divide',
                    inputs: {
                        a: null,
                        b: null
                    },
                    inputValues: {
                        a: 1,
                        b: 0
                    }
                },
                output: {
                    id: 'output',
                    name: 'Output',
                    class: 'Output',
                    position: { x: 0, y: 0 },
                    inputs: {
                        content: { sourceNode: 'ok', sourcePort: 0 }
                    },
                    inputValues: {}
                }
            }
        };

        await expect(collectFinal(new WorkflowRuntime(workflow).run())).resolves.toBe('ok');
    });

    it('fails when an error reaches Output', async () => {
        const workflow: WorkflowDefinition = {
            nodes: {
                broken: {
                    id: 'broken',
                    name: 'Broken Output Path',
                    class: 'NumberMath',
                    position: { x: 0, y: 0 },
                    operator: 'divide',
                    inputs: {
                        a: null,
                        b: null
                    },
                    inputValues: {
                        a: 1,
                        b: 0
                    }
                },
                output: {
                    id: 'output',
                    name: 'Output',
                    class: 'Output',
                    position: { x: 0, y: 0 },
                    inputs: {
                        content: { sourceNode: 'broken', sourcePort: 0 }
                    },
                    inputValues: {}
                }
            }
        };

        await expect(collectFinal(new WorkflowRuntime(workflow).run())).rejects.toThrow(
            'Broken Output Path failed: Cannot divide by zero: broken'
        );
    });

    it('runs typed string operators', async () => {
        const lengthWorkflow: WorkflowDefinition = {
            nodes: {
                source: {
                    id: 'source',
                    name: 'Source',
                    class: 'String',
                    position: { x: 0, y: 0 },
                    content: 'hello world',
                    inputs: {},
                    inputValues: {}
                },
                length: {
                    id: 'length',
                    name: 'Length',
                    class: 'StringLength',
                    position: { x: 0, y: 0 },
                    inputs: {
                        value: { sourceNode: 'source', sourcePort: 0 }
                    },
                    inputValues: {
                        value: ''
                    }
                },
                output: {
                    id: 'output',
                    name: 'Output',
                    class: 'Output',
                    position: { x: 0, y: 0 },
                    inputs: {
                        content: { sourceNode: 'length', sourcePort: 0 }
                    },
                    inputValues: {}
                }
            }
        };
        const includesWorkflow: WorkflowDefinition = {
            nodes: {
                includes: {
                    id: 'includes',
                    name: 'Includes',
                    class: 'StringIncludes',
                    position: { x: 0, y: 0 },
                    caseSensitive: false,
                    inputs: {
                        text: null,
                        search: null
                    },
                    inputValues: {
                        text: 'Hello World',
                        search: 'world'
                    }
                },
                output: {
                    id: 'output',
                    name: 'Output',
                    class: 'Output',
                    position: { x: 0, y: 0 },
                    inputs: {
                        content: { sourceNode: 'includes', sourcePort: 0 }
                    },
                    inputValues: {}
                }
            }
        };

        await expect(collectFinal(new WorkflowRuntime(lengthWorkflow).run())).resolves.toBe('11');
        await expect(collectFinal(new WorkflowRuntime(includesWorkflow).run())).resolves.toBe(
            'true'
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

    // Regression tests for streaming/skip/error event propagation.
    it('yields every intermediate value of a streaming Concat in order', async () => {
        const workflow: WorkflowDefinition = {
            nodes: {
                source: {
                    id: 'source',
                    name: 'Source',
                    class: 'String',
                    position: { x: 0, y: 0 },
                    content: 'abc',
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
                    inputValues: { a: '', b: 'X', separator: '' }
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

        const events = await collectEvents(new WorkflowRuntime(workflow).run());
        expect(events[events.length - 1]).toBe('abcX');
    });

    it('propagates a Gate skip to a downstream Ungate as false', async () => {
        const workflow: WorkflowDefinition = {
            nodes: {
                condition: {
                    id: 'condition',
                    name: 'Condition',
                    class: 'Boolean',
                    position: { x: 0, y: 0 },
                    value: false,
                    inputs: {},
                    inputValues: {}
                },
                gate: {
                    id: 'gate',
                    name: 'Gate',
                    class: 'Gate',
                    position: { x: 0, y: 0 },
                    inputs: { condition: { sourceNode: 'condition', sourcePort: 0 } },
                    inputValues: { condition: false }
                },
                ungate: {
                    id: 'ungate',
                    name: 'Ungate',
                    class: 'Ungate',
                    position: { x: 0, y: 0 },
                    inputs: { condition: { sourceNode: 'gate', sourcePort: 0 } },
                    inputValues: { condition: false }
                },
                output: {
                    id: 'output',
                    name: 'Output',
                    class: 'Output',
                    position: { x: 0, y: 0 },
                    inputs: { content: { sourceNode: 'ungate', sourcePort: 0 } },
                    inputValues: {}
                }
            }
        };

        const events = await collectEvents(new WorkflowRuntime(workflow).run());
        expect(events[events.length - 1]).toBe('false');
    });

    it('rejects run() and surfaces the failing node in the error message when Output errors', async () => {
        const workflow: WorkflowDefinition = {
            nodes: {
                broken: {
                    id: 'broken',
                    name: 'Broken Output Path',
                    class: 'NumberMath',
                    position: { x: 0, y: 0 },
                    operator: 'divide',
                    inputs: { a: null, b: null },
                    inputValues: { a: 1, b: 0 }
                },
                output: {
                    id: 'output',
                    name: 'Output',
                    class: 'Output',
                    position: { x: 0, y: 0 },
                    inputs: { content: { sourceNode: 'broken', sourcePort: 0 } },
                    inputValues: {}
                }
            }
        };

        await expect(collectEvents(new WorkflowRuntime(workflow).run())).rejects.toThrow(
            'Broken Output Path failed: Cannot divide by zero: broken'
        );
    });
});

async function collectFinal(stream: AsyncIterable<string>): Promise<string> {
    let final = '';
    for await (const value of stream) {
        final = value;
    }
    return final;
}

async function collectEvents(stream: AsyncIterable<string>): Promise<string[]> {
    const events: string[] = [];
    for await (const value of stream) {
        events.push(value);
    }
    return events;
}
