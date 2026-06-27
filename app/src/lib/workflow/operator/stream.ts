import type {
    WorkflowInputStream,
    WorkflowNodeStream,
    WorkflowPortType,
    WorkflowValue
} from '../types';
import { createWorkflowStreamState } from '../value';

export async function* executeStreamingOperator<TInput extends string>(
    inputs: Record<string, WorkflowInputStream>,
    initialValues: Record<TInput, WorkflowValue>,
    outputType: WorkflowPortType,
    evaluate: (latest: Readonly<Record<TInput, WorkflowValue>>) => WorkflowValue,
    signal: AbortSignal
): WorkflowNodeStream {
    throwIfAborted(signal);

    const latest = { ...initialValues };
    const activeInputs = Object.keys(initialValues)
        .map((inputId) => [inputId as TInput, inputs[inputId]] as const)
        .filter((entry): entry is readonly [TInput, WorkflowInputStream] => Boolean(entry[1]));

    if (activeInputs.length === 0) {
        yield createWorkflowStreamState(evaluate(latest), outputType);
        return;
    }

    const queue: WorkflowValue[] = [];
    let pending = activeInputs.length;
    let wake: (() => void) | undefined;
    let failure: unknown;
    let lastYielded: WorkflowValue | undefined;
    let hasYielded = false;

    const enqueue = () => {
        const value = evaluate(latest);
        const queuedValue = queue.at(-1);
        if (
            (queuedValue !== undefined && Object.is(value, queuedValue)) ||
            (queuedValue === undefined && hasYielded && Object.is(value, lastYielded))
        ) {
            return;
        }
        queue.push(value);
        wake?.();
        wake = undefined;
    };

    for (const [inputId, input] of activeInputs) {
        void (async () => {
            try {
                for await (const state of input.stream()) {
                    throwIfAborted(signal);
                    latest[inputId] = state.value;
                    enqueue();
                }
            } catch (error) {
                failure = error;
                wake?.();
                wake = undefined;
            } finally {
                pending -= 1;
                wake?.();
                wake = undefined;
            }
        })();
    }

    while (pending > 0 || queue.length > 0) {
        throwIfAborted(signal);
        if (failure) throw failure;

        const next = queue.shift();
        if (next !== undefined) {
            lastYielded = next;
            hasYielded = true;
            yield createWorkflowStreamState(next, outputType);
            continue;
        }

        await new Promise<void>((resolve) => {
            wake = resolve;
        });
    }

    if (failure) throw failure;

    const finalValue = evaluate(latest);
    if (!hasYielded || !Object.is(finalValue, lastYielded)) {
        yield createWorkflowStreamState(finalValue, outputType);
    }
}

function throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) {
        throw new DOMException('Workflow run aborted', 'AbortError');
    }
}
