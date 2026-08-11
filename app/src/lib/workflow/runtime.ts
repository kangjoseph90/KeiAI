import { AppError } from '$lib/types/errors';
import { executeWorkflowNode } from './executors';
import { validateWorkflow } from './validation';
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
    createWorkflowValueEvent,
    inferWorkflowValueType
} from './util';
import {
    canConnectWorkflowPortTypes,
    getWorkflowInputPortDefinition,
    getWorkflowOutputPortDefinition,
    isSinkWorkflowNode
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
    terminal?: WorkflowNodeEvent;
    ports: Map<number, PortRuntime>;
    done: Promise<void>;
}

interface PortRuntime {
    latest: WorkflowNodeEvent;
    subscribers: Set<(value: WorkflowValue) => void>;
}

export class WorkflowRuntime {
    readonly #workflow: WorkflowDefinition;
    readonly #ctx: RuntimeContext | undefined;
    readonly #localMacros: ReadonlyMap<string, Macro> | undefined;
    readonly #messages: PagedMessages | undefined;
    readonly #signal: AbortSignal;
    readonly #runtimes = new Map<string, NodeRuntime>();
    readonly #runtimeOutputSubscribers = new Set<(event: WorkflowNodeEvent) => void>();
    #latestRuntimeOutput: WorkflowNodeEvent = createWorkflowSkipEvent(
        'Workflow produced no output'
    );

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
        const nodeIds = Object.keys(this.#workflow.nodes);

        // Start only sink nodes (Output, Sink, SetChatVar, FileWrite). Dependencies are
        // pulled lazily as each root resolves its inputs via #resolveConnection.
        const rootNodeIds = nodeIds.filter((id) => isSinkWorkflowNode(this.#workflow.nodes[id]));
        const outputNodeIds = rootNodeIds.filter(
            (nodeId) => this.#workflow.nodes[nodeId]?.class === 'Output'
        );

        // subscriber-based queue. Values are consumed and GC'd after yield.
        const queue: string[] = [];
        let resolveNext: (() => void) | null = null;
        const outputSubscriber = (event: WorkflowNodeEvent) => {
            if (event.status === 'value') {
                queue.push(String(event.value));
                resolveNext?.();
            }
        };
        this.#runtimeOutputSubscribers.add(outputSubscriber);

        // Track active outputs using a simple counter.
        let activeOutputsCount = outputNodeIds.length;
        const onOutputSettled = () => {
            activeOutputsCount -= 1;
            resolveNext?.();
        };
        const rootRuns = rootNodeIds.map((nodeId) => this.#getOrCreateRuntime(nodeId).done);
        const outputRuns = rootNodeIds
            .filter((nodeId) => this.#workflow.nodes[nodeId]?.class === 'Output')
            .map((nodeId) => this.#getOrCreateRuntime(nodeId).done);
        for (const done of outputRuns) {
            void done.then(onOutputSettled, onOutputSettled);
        }

        try {
            while (queue.length > 0 || activeOutputsCount > 0) {
                if (queue.length > 0) {
                    yield queue.shift()!;
                } else {
                    await new Promise<void>((resolve) => {
                        resolveNext = resolve;
                    });
                    resolveNext = null;
                }
            }
        } finally {
            this.#runtimeOutputSubscribers.delete(outputSubscriber);
        }

        await Promise.all(rootRuns);
        const rootError = rootNodeIds
            .map((nodeId) => this.#runtimes.get(nodeId)?.terminal)
            .find((event) => event?.status === 'error');
        if (rootError?.status === 'error') throw rootError.error;
        if (this.#latestRuntimeOutput.status === 'error') throw this.#latestRuntimeOutput.error;
    }

    #getOrCreateRuntime(nodeId: string): NodeRuntime {
        const existing = this.#runtimes.get(nodeId);
        if (existing) return existing;

        const runtime: NodeRuntime = {
            finished: false,
            ports: new Map(),
            done: Promise.resolve()
        };
        this.#runtimes.set(nodeId, runtime);

        const done = this.#runNode(nodeId, runtime);
        runtime.done = done;
        void done.catch(() => undefined);
        return runtime;
    }

    async #runNode(nodeId: string, runtime: NodeRuntime): Promise<void> {
        const node = this.#workflow.nodes[nodeId];
        if (!node) {
            throw new AppError('NOT_FOUND', `Workflow node not found: ${nodeId}`);
        }

        const output = this.#createOutput(node, runtime);
        try {
            const inputs = this.#resolveInputs(node);
            await executeWorkflowNode({
                node,
                inputs,
                output,
                emitRuntimeOutput: (event) => this.#emitRuntimeOutput(event),
                ctx: this.#ctx,
                localMacros: this.#localMacros,
                messages: this.#messages,
                signal: this.#signal
            });
        } catch (error) {
            if (!runtime.finished) {
                const event = createWorkflowErrorEvent(node, error);
                this.#finish(runtime, event);
                if (node.class === 'Output') this.#emitRuntimeOutput(event);
            }
            return;
        }

        // Auto-complete: if executor returned without a terminal emit, finalize with latest.
        if (!runtime.finished) {
            this.#finish(runtime);
        }
    }

    #createOutput(node: WorkflowNode, runtime: NodeRuntime): WorkflowOutput {
        return {
            emit: (port: number, event: WorkflowNodeEvent) => {
                if (runtime.finished) return;
                const definition = getWorkflowOutputPortDefinition(node, port);
                if (!definition) {
                    this.#finish(
                        runtime,
                        createWorkflowErrorEvent(
                            node,
                            new AppError(
                                'INVALID_INPUT',
                                `Workflow output port not found: ${node.id}.${port}`
                            )
                        )
                    );
                    return;
                }
                if (
                    event.status === 'value' &&
                    !canConnectWorkflowPortTypes(
                        definition.type,
                        inferWorkflowValueType(event.value)
                    )
                ) {
                    this.#finish(
                        runtime,
                        createWorkflowErrorEvent(
                            node,
                            new AppError(
                                'INVALID_INPUT',
                                `Workflow output port type mismatch: ${node.id}.${port} expected ${definition.type}`
                            )
                        )
                    );
                    return;
                }
                const portRuntime = this.#getOrCreatePortRuntime(runtime, port);
                portRuntime.latest = event;
                if (event.status === 'value') {
                    for (const sub of portRuntime.subscribers) sub(event.value);
                } else {
                    this.#finish(runtime, event);
                }
            }
        };
    }

    #finish(runtime: NodeRuntime, event?: WorkflowNodeEvent): void {
        if (runtime.finished) return;
        runtime.finished = true;
        if (event) {
            runtime.terminal = event;
            for (const port of runtime.ports.values()) {
                port.latest = event;
            }
        }
    }

    #getOrCreatePortRuntime(runtime: NodeRuntime, port: number): PortRuntime {
        const existing = runtime.ports.get(port);
        if (existing) return existing;
        const created: PortRuntime = {
            latest: runtime.terminal ?? createWorkflowSkipEvent('Input produced no output'),
            subscribers: new Set()
        };
        runtime.ports.set(port, created);
        return created;
    }

    #emitRuntimeOutput(event: WorkflowNodeEvent): void {
        this.#latestRuntimeOutput = event;
        for (const subscriber of this.#runtimeOutputSubscribers) {
            subscriber(event);
        }
    }

    #resolveInputs(node: WorkflowNode): Record<string, WorkflowInput> {
        const inputs: Record<string, WorkflowInput> = {};
        for (const [inputName, connection] of Object.entries(node.inputs)) {
            const input = getWorkflowInputPortDefinition(node, inputName);
            const inputType = input?.type ?? 'string';
            if (connection) {
                inputs[inputName] = this.#resolveConnection(connection, inputType);
            } else if (input?.allowLiteral !== false && inputName in node.inputValues) {
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
        const upstreamPort = this.#getOrCreatePortRuntime(upstream, connection.sourcePort);
        return {
            subscribe: (onValue) => {
                upstreamPort.subscribers.add((value) => {
                    onValue(coerceWorkflowValue(value, targetType));
                });
                // Late subscription: deliver latest if upstream already pushed a value.
                if (upstreamPort.latest.status === 'value') {
                    onValue(coerceWorkflowValue(upstreamPort.latest.value, targetType));
                }
            },
            done: upstream.done.then(() => coerceEvent(upstreamPort.latest, targetType))
        };
    }
}

function coerceEvent(event: WorkflowNodeEvent, targetType: WorkflowPortType): WorkflowNodeEvent {
    if (event.status !== 'value') return event;
    const value = coerceWorkflowValue(event.value, targetType);
    return createWorkflowValueEvent(value);
}
