import type { AgentConfiguration, WorkflowDefinition } from '$lib/workflow';

export interface KeiWorkflowPackageV1 {
    version: 1;
    kind: 'keiai.workflow';
    workflow: WorkflowDefinition;
}

export interface KeiAgentPackageV1 {
    version: 1;
    kind: 'keiai.agent';
    agent: AgentConfiguration;
}
