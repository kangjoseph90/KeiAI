import { AppError } from '$lib/types/errors';
import { executeWorkflowNode } from './executors';
import { getWorkflowOutputNodeId, validateWorkflow } from './validation';
import type {
    InputPort,
    WorkflowDefinition,
    WorkflowInputStream,
    WorkflowNodeExecutionContext,
    WorkflowPortType,
    WorkflowValue,
    WorkflowNodeStream,
    WorkflowNodeStreamState
} from './types';
import { coerceWorkflowValue, createWorkflowStreamState } from './value';
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
    done: Promise<WorkflowValue>;
    latest?: WorkflowNodeStreamState;
    finished: boolean;
    error: unknown;
    subscribers: Set<NodeRuntimeSubscriber>;
}

interface NodeRuntimeSubscriber {
    push: (state: WorkflowNodeStreamState) => void;
    close: () => void;
    fail: (error: unknown) => void;
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

    /** Runs every node, exposes only Output, and completes after every path settles. */
    async *run(): WorkflowNodeStream {
        const outputNodeId = getWorkflowOutputNodeId(this.#workflow);
        const nodeIds = [
            outputNodeId,
            ...Object.keys(this.#workflow.nodes).filter((nodeId) => nodeId !== outputNodeId)
        ];
        const runs = nodeIds.map((nodeId) => this.#getOrCreateRuntime(nodeId).done);
        let outputFailure: { error: unknown } | undefined;
        let results: PromiseSettledResult<WorkflowValue>[] = [];

        try {
            for await (const state of this.#streamNode(outputNodeId)) {
                yield state;
            }
        } catch (error) {
            outputFailure = { error };
        } finally {
            results = await Promise.allSettled(runs);
        }

        if (outputFailure) throw outputFailure.error;

        const failed = results.find(
            (result): result is PromiseRejectedResult => result.status === 'rejected'
        );
        if (failed) throw failed.reason;
    }

    async #runNode(nodeId: string, runtime: NodeRuntime): Promise<WorkflowValue> {
        const node = this.#workflow.nodes[nodeId];
        if (!node) {
            throw new AppError('NOT_FOUND', `Workflow node not found: ${nodeId}`);
        }
        try {
            const inputs = this.#resolveInputs(node);
            let finalValue: WorkflowValue = '';

            for await (const state of executeWorkflowNode({
                node,
                inputs,
                ctx: this.#ctx,
                localMacros: this.#localMacros,
                messages: this.#messages,
                signal: this.#signal
            })) {
                finalValue = state.value;
                this.#publish(runtime, state);
            }

            runtime.finished = true;
            this.#closeSubscribers(runtime);
            return finalValue;
        } catch (error) {
            runtime.finished = true;
            runtime.error = error;
            this.#failSubscribers(runtime, error);
            throw error;
        }
    }

    #resolveInputs(
        node: WorkflowNodeExecutionContext['node']
    ): Record<string, WorkflowInputStream> {
        const inputs: Record<string, WorkflowInputStream> = {};
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

    #resolveLiteral(value: WorkflowValue, type: WorkflowPortType): WorkflowInputStream {
        const typedValue = coerceWorkflowValue(value, type);
        return {
            stream: async function* () {
                yield createWorkflowStreamState(typedValue, type);
            },
            final: async () => typedValue
        };
    }

    #resolveConnection(
        connection: Exclude<InputPort, null>,
        targetType: WorkflowPortType
    ): WorkflowInputStream {
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
        return {
            stream: () => this.#coerceStream(this.#streamNode(connection.sourceNode), targetType),
            final: async () =>
                coerceWorkflowValue(
                    await this.#getOrCreateRuntime(connection.sourceNode).done,
                    targetType
                )
        };
    }

    async *#coerceStream(
        stream: WorkflowNodeStream,
        targetType: WorkflowPortType
    ): WorkflowNodeStream {
        for await (const state of stream) {
            const value = coerceWorkflowValue(state.value, targetType);
            yield createWorkflowStreamState(value, targetType);
        }
    }

    #getOrCreateRuntime(nodeId: string): NodeRuntime {
        const existing = this.#runtimes.get(nodeId);
        if (existing) return existing;

        const runtime: NodeRuntime = {
            finished: false,
            error: undefined,
            subscribers: new Set(),
            done: Promise.resolve('')
        };
        this.#runtimes.set(nodeId, runtime);
        runtime.done = this.#runNode(nodeId, runtime);
        void runtime.done.catch(() => undefined);

        return runtime;
    }

    #publish(runtime: NodeRuntime, state: WorkflowNodeStreamState): void {
        runtime.latest = state;
        for (const subscriber of runtime.subscribers) {
            subscriber.push(state);
        }
    }

    async *#streamNode(nodeId: string): WorkflowNodeStream {
        const runtime = this.#getOrCreateRuntime(nodeId);

        if (runtime.finished) {
            if (runtime.error) throw runtime.error;
            if (runtime.latest) yield runtime.latest;
            return;
        }

        const queue: WorkflowNodeStreamState[] = [];
        let wake: (() => void) | undefined;
        let closed = false;
        let failure: unknown;

        const notify = () => {
            wake?.();
            wake = undefined;
        };

        const subscriber: NodeRuntimeSubscriber = {
            push: (state) => {
                queue.push(state);
                notify();
            },
            close: () => {
                closed = true;
                notify();
            },
            fail: (error) => {
                failure = error;
                closed = true;
                notify();
            }
        };

        runtime.subscribers.add(subscriber);
        if (runtime.latest) queue.push(runtime.latest);

        try {
            while (true) {
                const next = queue.shift();
                if (next) {
                    yield next;
                    continue;
                }
                if (failure) throw failure;
                if (closed) return;

                await new Promise<void>((resolve) => {
                    wake = resolve;
                });
            }
        } finally {
            runtime.subscribers.delete(subscriber);
        }
    }

    #closeSubscribers(runtime: NodeRuntime): void {
        for (const subscriber of runtime.subscribers) {
            subscriber.close();
        }
        runtime.subscribers.clear();
    }

    #failSubscribers(runtime: NodeRuntime, error: unknown): void {
        for (const subscriber of runtime.subscribers) {
            subscriber.fail(error);
        }
        runtime.subscribers.clear();
    }
}
