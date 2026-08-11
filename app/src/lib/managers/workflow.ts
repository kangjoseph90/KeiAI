import { appDialog } from '$lib/adapters/dialog';
import {
    readAgentFile,
    readWorkflowFile,
    writeAgentFile,
    writeWorkflowFile
} from '$lib/porters/workflow';
import { sanitizeFileName } from '$lib/utils/file';
import type { AgentConfiguration, AgentNode, WorkflowDefinition } from '$lib/workflow';

const JSON_FILTER = [{ name: 'JSON', extensions: ['json'] }];

export async function importWorkflowFile(): Promise<WorkflowDefinition | null> {
    const file = await appDialog.openFile({ title: 'Import Workflow', filters: JSON_FILTER });
    return file ? readWorkflowFile(file) : null;
}

export async function exportWorkflowFile(
    workflow: WorkflowDefinition,
    name: string
): Promise<boolean> {
    return appDialog.saveBytes({
        bytes: writeWorkflowFile(workflow),
        fileName: `${sanitizeFileName(name || 'workflow')}.workflow.json`,
        mimeType: 'application/json',
        title: 'Export Workflow',
        filters: JSON_FILTER
    });
}

export async function importAgentFile(): Promise<AgentConfiguration | null> {
    const file = await appDialog.openFile({ title: 'Import Agent', filters: JSON_FILTER });
    return file ? readAgentFile(file) : null;
}

export async function exportAgentFile(agent: AgentNode): Promise<boolean> {
    return appDialog.saveBytes({
        bytes: writeAgentFile(agent),
        fileName: `${sanitizeFileName(agent.name || 'agent')}.agent.json`,
        mimeType: 'application/json',
        title: 'Export Agent',
        filters: JSON_FILTER
    });
}
