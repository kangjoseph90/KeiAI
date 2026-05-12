import type { OpenAIChat } from '$lib/llm/types';
import type { TemplateContext } from '$lib/template/types';

export type PipelineContext = TemplateContext;

export interface PipelineHandler<T, K extends string = string> {
    id: string;
    phase: K;
    order: number;
    run(data: T, context: PipelineContext): Promise<T | undefined>;
}

export interface PipelinePhaseType {
    input: string;
    request: string;
    prompt: OpenAIChat[];
    output: string;
    display: string;
}

export type PipelinePhase<P> = P extends keyof PipelinePhaseType ? never : P;
