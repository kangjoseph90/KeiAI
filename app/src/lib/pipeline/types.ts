export interface PipelineHandler<T> {
	id: string;
	phase: string;
	order: number;
	run(data: T): Promise<T | undefined>;
}

export interface PhaseType {
	input: string;
	request: string;
	output: string;
	display: string;
}

export type Phase<P> = P extends keyof PhaseType ? never : P;
