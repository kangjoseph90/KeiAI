import type { LLMMessage } from '$lib/llm/types';
import type { RuntimeContext } from '$lib/types/context';

export interface PipelineHandler<T, K extends string = string> {
    id: string;
    phase: K;
    order: number;
    run(data: T, context: RuntimeContext): Promise<T | undefined>;
}

export interface PipelinePhaseType {
    input: string;
    request: string;
    prompt: LLMMessage[];
    output: string;
    display: string;
}

export type PipelinePhase<P> = P extends keyof PipelinePhaseType ? never : P;
