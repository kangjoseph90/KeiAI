import type { OpenAIChat } from '$lib/llm/types';
import type { TemplateContext } from '$lib/template/types';

export type PipelineContextType = {
    [K in keyof PipelinePhaseType]: TemplateContext;
};

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
    prompt: OpenAIChat[];
    output: string;
    display: string;
}

export type PipelinePhase<P> = P extends keyof PipelinePhaseType ? never : P;
