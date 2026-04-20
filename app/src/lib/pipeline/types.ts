export type PipelineRole = 'user' | 'char' | 'system' | 'assistant';

export interface PipelineContextType {
    input: { role: PipelineRole };
    request: {
        role: PipelineRole;
    };
    output: {
        messageId: string;
    };
    display: {
        messageId: string;
        role: PipelineRole;
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
