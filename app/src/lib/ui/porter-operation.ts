import { get, writable } from 'svelte/store';
import type { PorterPhase, PorterProgress, PorterProgressReporter } from '$lib/porters/progress';
import { getErrorMessage } from '$lib/types/errors';

export type PorterOperationKind = 'import' | 'export';
export type PorterOperationEntity = 'character' | 'persona' | 'module';

export interface PorterOperationState {
    kind: PorterOperationKind;
    entity: PorterOperationEntity;
    phase: PorterPhase;
    completed: number;
    total: number;
    /** Present only after the operation failed; the dialog stays open until dismissed. */
    error?: string;
}

export const porterOperation = writable<PorterOperationState | null>(null);

/**
 * Run an import/export operation behind a blocking progress dialog.
 * The dialog opens on the first progress report, closes on success, and on
 * failure keeps the last phase and error visible until the user dismisses it.
 *
 * Returns the operation result, or undefined when the operation failed after
 * reporting (the failure is already presented by the dialog) or when another
 * operation is already running. Failures before the first report rethrow so
 * callers keep their usual error handling.
 */
export async function runPorterOperation<T>(
    meta: { kind: PorterOperationKind; entity: PorterOperationEntity },
    operation: (onProgress: PorterProgressReporter) => Promise<T>
): Promise<T | undefined> {
    if (get(porterOperation)) return undefined;

    let reported = false;
    const onProgress: PorterProgressReporter = (progress: PorterProgress) => {
        reported = true;
        porterOperation.set({ ...meta, ...progress });
    };

    try {
        const result = await operation(onProgress);
        if (reported) porterOperation.set(null);
        return result;
    } catch (error) {
        if (!reported) throw error;
        porterOperation.update((current) => ({
            kind: meta.kind,
            entity: meta.entity,
            phase: current?.phase ?? 'preparing',
            completed: current?.completed ?? 0,
            total: current?.total ?? 0,
            error: getErrorMessage(error)
        }));
        return undefined;
    }
}

export function dismissPorterOperation(): void {
    porterOperation.set(null);
}
