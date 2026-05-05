import type { LLMRole } from '$lib/types/models/llm';

export interface PipelineContextType {
    input: { role: LLMRole };
    request: {
        role: LLMRole;
    };
    output: {
        messageId: string;
    };
    display: {
        messageId: string;
        role: LLMRole;
    };
}

export type PipelineContext<K extends string = string> = K extends keyof PipelineContextType
    ? PipelineContextType[K]
    : Record<string, unknown>;

export interface PipelineHandler<T, K extends string = string> {
    id: string;
    phase: K;
    order: number;
    run(data: T, context: PipelineContext<K>): Promise<T | undefined>;
}

export interface PipelinePhaseType {
    input: string;
    request: string;
    output: string;
    display: string;
}

export type PipelinePhase<P> = P extends keyof PipelinePhaseType ? never : P;
