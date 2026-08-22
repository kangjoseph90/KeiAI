/**
 * Progress contract shared by porter operations and their UI presentation.
 * Porters report real processing steps; presentation layers render them.
 */

export type PorterPhase = 'preparing' | 'processing-data' | 'processing-assets' | 'finalizing';

export interface PorterProgress {
    phase: PorterPhase;
    /** Assets processed so far in the current operation. */
    completed: number;
    /** Total assets in the operation; 0 when the count is not yet known. */
    total: number;
}

export type PorterProgressReporter = (progress: PorterProgress) => void;

/**
 * Wrap a reporter so the latest progress can be re-emitted with a new phase,
 * e.g. when a caller finalizes an operation after a porter has finished.
 */
export function trackPorterProgress(
    onProgress: PorterProgressReporter | undefined
): { report: PorterProgressReporter; last: () => PorterProgress } | undefined {
    if (!onProgress) return undefined;
    let latest: PorterProgress = { phase: 'preparing', completed: 0, total: 0 };
    return {
        report: (progress: PorterProgress) => {
            latest = progress;
            onProgress(progress);
        },
        last: () => latest
    };
}
