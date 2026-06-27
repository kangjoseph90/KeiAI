import { AppError } from '$lib/types/errors';
import { executeWorkflowNode } from './executors';
import { getWorkflowOutputNodeId, validateWorkflow } from './validation';
import type {
    InputPort,
    WorkflowDefinition,
    WorkflowInput,
    WorkflowNode,
    WorkflowNodeEvent,
    WorkflowOutput,
    WorkflowPortType,
    WorkflowValue
} from './types';
import {
    coerceWorkflowValue,
    createWorkflowErrorEvent,
    createWorkflowSkipEvent,
    createWorkflowValueEvent
} from './util';
import {
    canConnectWorkflowPortTypes,
    getWorkflowInputPortDefinition,
    getWorkflowOutputPortDefinition
} from './registry';
import type { Macro } from '$lib/template';
import type { RuntimeContext } from '$lib/types/context';
import type { PagedMessages } from '$lib/services/content/paged_messages';

export interface WorkflowRuntimeOptions {
    ctx?: RuntimeContext;
    localMacros?: ReadonlyMap<string, Macro>;
    messages?: PagedMessages;
    signal?: AbortSignal;
}

interface NodeRuntime {
    finished: boolean;
    latest: WorkflowNodeEvent;
    subscribers: Set<(value: WorkflowValue) => void>;
    done: Promise<WorkflowNodeEvent>;
}

export class WorkflowRuntime {
    readonly #workflow: WorkflowDefinition;
    readonly #ctx: RuntimeContext | undefined;
    readonly #localMacros: ReadonlyMap<string, Macro> | undefined;
    readonly #messages: PagedMessages | undefined;
    readonly #signal: AbortSignal;
    readonly #runtimes = new Map<string, NodeRuntime>();

    constructor(workflow: WorkflowDefinition, options: WorkflowRuntimeOptions = {}) {
        validateWorkflow(workflow);
        this.#workflow = workflow;
        this.#ctx = options.ctx;
        this.#localMacros = options.localMacros;
        this.#messages = options.messages;
        this.#signal = options.signal ?? new AbortController().signal;
    }

    /** Runs every node and yields Output's string stream, settling after every path completes. */
    async *run(): AsyncGenerator<string> {
        const outputNodeId = getWorkflowOutputNodeId(this.#workflow);
        const outputRuntime = this.#getOrCreateRuntime(outputNodeId);

        // Eagerly start every node (current policy: disconnected side-effects run too).
        const runs = Object.keys(this.#workflow.nodes).map(
            (nodeId) => this.#getOrCreateRuntime(nodeId).done
        );

        // Bridge: subscriber-based queue. Values are consumed and GC'd after yield.
        const queue: string[] = [];
        if (outputRuntime.latest.status === 'value') {
            queue.push(String(outputRuntime.latest.value));
        }

        let resolveNext: (() => void) | null = null;
        const valueSubscriber = (value: WorkflowValue) => {
            queue.push(String(value));
            resolveNext?.();
        };
        outputRuntime.subscribers.add(valueSubscriber);

        try {
            while (queue.length > 0 || !outputRuntime.finished) {
                if (queue.length > 0) {
                    yield queue.shift()!;
                } else {
                    await new Promise<void>((resolve) => {
                        resolveNext = resolve;
                        void outputRuntime.done.then(() => resolveNext?.());
                    });
                    resolveNext = null;
                }
            }
        } finally {
            outputRuntime.subscribers.delete(valueSubscriber);
        }

        await Promise.all(runs);
        const outputResult = await outputRuntime.done;
        if (outputResult.status === 'error') throw outputResult.error;
    }

    #getOrCreateRuntime(nodeId: string): NodeRuntime {
        const existing = this.#runtimes.get(nodeId);
        if (existing) return existing;

        const runtime: NodeRuntime = {
            finished: false,
            latest: createWorkflowSkipEvent('Input produced no output'),
            subscribers: new Set(),
            done: Promise.resolve(createWorkflowSkipEvent('Input produced no output'))
        };
        this.#runtimes.set(nodeId, runtime);

        const done = this.#runNode(nodeId, runtime);
        runtime.done = done;
        void done.catch(() => undefined);
        return runtime;
    }

    async #runNode(nodeId: string, runtime: NodeRuntime): Promise<WorkflowNodeEvent> {
        const node = this.#workflow.nodes[nodeId];
        if (!node) {
            throw new AppError('NOT_FOUND', `Workflow node not found: ${nodeId}`);
        }

        const output = this.#createOutput(runtime);
        try {
            const inputs = this.#resolveInputs(node);
            await executeWorkflowNode({
                node,
                inputs,
                output,
                ctx: this.#ctx,
                localMacros: this.#localMacros,
                messages: this.#messages,
                signal: this.#signal
            });
        } catch (error) {
            if (!runtime.finished) {
                this.#finish(runtime, createWorkflowErrorEvent(node, error));
            }
            return runtime.latest;
        }

        // Auto-complete: if executor returned without a terminal emit, finalize with latest.
        if (!runtime.finished) {
            this.#finish(runtime, runtime.latest);
        }
        return runtime.latest;
    }

    #createOutput(runtime: NodeRuntime): WorkflowOutput {
        return {
            emit: (event: WorkflowNodeEvent) => {
                if (runtime.finished) return;
                runtime.latest = event;
                if (event.status === 'value') {
                    for (const sub of runtime.subscribers) sub(event.value);
                } else {
                    this.#finish(runtime, event);
                }
            }
        };
    }

    #finish(runtime: NodeRuntime, event: WorkflowNodeEvent): void {
        if (runtime.finished) return;
        runtime.finished = true;
        runtime.latest = event;
    }

    #resolveInputs(node: WorkflowNode): Record<string, WorkflowInput> {
        const inputs: Record<string, WorkflowInput> = {};
        for (const [inputName, connection] of Object.entries(node.inputs)) {
            const input = getWorkflowInputPortDefinition(node, inputName);
            const inputType = input?.type ?? 'string';
            if (connection) {
                inputs[inputName] = this.#resolveConnection(connection, inputType);
            } else if (inputName in node.inputValues) {
                inputs[inputName] = this.#resolveLiteral(node.inputValues[inputName], inputType);
            }
        }
        return inputs;
    }

    #resolveLiteral(value: WorkflowValue, type: WorkflowPortType): WorkflowInput {
        const typedValue = coerceWorkflowValue(value, type);
        return {
            subscribe: (onValue) => {
                onValue(typedValue);
            },
            done: Promise.resolve(createWorkflowValueEvent(typedValue))
        };
    }

    #resolveConnection(
        connection: Exclude<InputPort, null>,
        targetType: WorkflowPortType
    ): WorkflowInput {
        const source = this.#workflow.nodes[connection.sourceNode];
        const output = source
            ? getWorkflowOutputPortDefinition(source, connection.sourcePort)
            : undefined;
        if (!source || !output) {
            throw new AppError(
                'NOT_FOUND',
                `Workflow output port not found: ${connection.sourceNode}.${connection.sourcePort}`
            );
        }
        if (!canConnectWorkflowPortTypes(output.type, targetType)) {
            throw new AppError(
                'INVALID_INPUT',
                `Workflow port type mismatch: ${connection.sourceNode}.${connection.sourcePort} (${output.type}) -> ${targetType}`
            );
        }

        const upstream = this.#getOrCreateRuntime(connection.sourceNode);
        return {
            subscribe: (onValue) => {
                upstream.subscribers.add((value) => {
                    onValue(coerceWorkflowValue(value, targetType));
                });
                // Late subscription: deliver latest if upstream already pushed a value.
                if (upstream.latest.status === 'value') {
                    onValue(coerceWorkflowValue(upstream.latest.value, targetType));
                }
            },
            done: upstream.done.then((event) => coerceEvent(event, targetType))
        };
    }
}

function coerceEvent(event: WorkflowNodeEvent, targetType: WorkflowPortType): WorkflowNodeEvent {
    if (event.status !== 'value') return event;
    const value = coerceWorkflowValue(event.value, targetType);
    return createWorkflowValueEvent(value);
}
