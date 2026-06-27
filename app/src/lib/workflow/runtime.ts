import { AppError } from '$lib/types/errors';
import { executeWorkflowNode } from './executors';
import { getWorkflowOutputNodeId, validateWorkflow } from './validation';
import type {
    InputPort,
    WorkflowDefinition,
    WorkflowInputStream,
    WorkflowNodeExecutionContext,
    WorkflowNodeStream,
    WorkflowNodeStreamState,
    WorkflowRunEvent
} from './types';
import type { Macro } from '$lib/template';
import type { RuntimeContext } from '$lib/types/context';
import type { PagedMessages } from '$lib/services/content/paged_messages';

export interface WorkflowRuntimeOptions {
    ctx?: RuntimeContext;
    localMacros?: ReadonlyMap<string, Macro>;
    messages?: PagedMessages;
    signal?: AbortSignal;
    onEvent?: (event: WorkflowRunEvent) => void;
}

interface NodeRuntime {
    done: Promise<string>;
    latest: string;
    hasValue: boolean;
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
    readonly #onEvent: ((event: WorkflowRunEvent) => void) | undefined;
    readonly #runtimes = new Map<string, NodeRuntime>();

    constructor(workflow: WorkflowDefinition, options: WorkflowRuntimeOptions = {}) {
        validateWorkflow(workflow);
        this.#workflow = workflow;
        this.#ctx = options.ctx;
        this.#localMacros = options.localMacros;
        this.#messages = options.messages;
        this.#signal = options.signal ?? new AbortController().signal;
        this.#onEvent = options.onEvent;
    }

    /** Streams the workflow's single Output node to completion. */
    run(): WorkflowNodeStream {
        return this.#streamNode(getWorkflowOutputNodeId(this.#workflow));
    }

    /** Resolves a node's final content, executing upstream on demand. */
    runNode(nodeId: string): Promise<string> {
        return this.#getOrCreateRuntime(nodeId).done;
    }

    async #runNode(nodeId: string): Promise<string> {
        const node = this.#workflow.nodes[nodeId];
        if (!node) {
            throw new AppError('NOT_FOUND', `Workflow node not found: ${nodeId}`);
        }
        const runtime = this.#getRuntime(nodeId);
        this.#emit({ type: 'nodeStart', nodeId });

        try {
            const inputs = this.#resolveInputs(node);
            let finalContent = '';

            for await (const state of executeWorkflowNode({
                node,
                inputs,
                ctx: this.#ctx,
                localMacros: this.#localMacros,
                messages: this.#messages,
                signal: this.#signal
            })) {
                finalContent = state.content;
                this.#publish(nodeId, state);
                this.#emit({ type: 'nodeOutput', nodeId, content: finalContent });
            }

            runtime.finished = true;
            this.#closeSubscribers(runtime);
            this.#emit({ type: 'nodeEnd', nodeId, content: finalContent });
            return finalContent;
        } catch (error) {
            runtime.finished = true;
            runtime.error = error;
            this.#failSubscribers(runtime, error);
            const message = error instanceof Error ? error.message : 'Unknown workflow node error';
            this.#emit({ type: 'nodeError', nodeId, error: message });
            throw error;
        }
    }

    #resolveInputs(
        node: WorkflowNodeExecutionContext['node']
    ): Record<string, WorkflowInputStream> {
        const inputs: Record<string, WorkflowInputStream> = {};
        for (const [inputName, connection] of Object.entries(node.inputs)) {
            if (!connection) continue;
            inputs[inputName] = this.#resolveConnection(connection);
        }
        return inputs;
    }

    #resolveConnection(connection: Exclude<InputPort, null>): WorkflowInputStream {
        if (connection.sourcePort !== 0) {
            throw new AppError(
                'INVALID_INPUT',
                `Only sourcePort 0 is supported by the string-only workflow runtime: ${connection.sourcePort}`
            );
        }
        return {
            stream: () => this.#streamNode(connection.sourceNode),
            final: () => this.runNode(connection.sourceNode)
        };
    }

    #getOrCreateRuntime(nodeId: string): NodeRuntime {
        const existing = this.#runtimes.get(nodeId);
        if (existing) return existing;

        const runtime: NodeRuntime = {
            latest: '',
            hasValue: false,
            finished: false,
            error: undefined,
            subscribers: new Set(),
            done: Promise.resolve('')
        };
        this.#runtimes.set(nodeId, runtime);
        runtime.done = this.#runNode(nodeId);
        void runtime.done.catch(() => undefined);

        return runtime;
    }

    #getRuntime(nodeId: string): NodeRuntime {
        const runtime = this.#runtimes.get(nodeId);
        if (!runtime) {
            throw new AppError('NOT_FOUND', `Workflow node runtime not found: ${nodeId}`);
        }
        return runtime;
    }

    #publish(nodeId: string, state: WorkflowNodeStreamState): void {
        const runtime = this.#getRuntime(nodeId);
        runtime.latest = state.content;
        runtime.hasValue = true;
        for (const subscriber of runtime.subscribers) {
            subscriber.push(state);
        }
    }

    async *#streamNode(nodeId: string): WorkflowNodeStream {
        const runtime = this.#getOrCreateRuntime(nodeId);

        if (runtime.hasValue) {
            yield { content: runtime.latest };
        }
        if (runtime.finished) {
            if (runtime.error) throw runtime.error;
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

    #emit(event: WorkflowRunEvent): void {
        this.#onEvent?.(event);
    }
}

/** Convenience wrapper: build a runtime and stream its output node. */
export function runWorkflow(
    workflow: WorkflowDefinition,
    options: WorkflowRuntimeOptions = {}
): WorkflowNodeStream {
    return new WorkflowRuntime(workflow, options).run();
}
