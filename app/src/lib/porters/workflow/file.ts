import { AppError } from '$lib/types/errors';
import { isRecord } from '$lib/porters/utils';
import {
    createDefaultWorkflowNode,
    validateWorkflow,
    WORKFLOW_NODE_DEFINITIONS,
    type AgentConfiguration,
    type AgentNode,
    type WorkflowDefinition,
    type WorkflowValue
} from '$lib/workflow';
import { normalizeWorkflow } from '$lib/workflow/normalization';
import type { KeiAgentPackageV1, KeiWorkflowPackageV1 } from './types';

const TEXT_ENCODER = new TextEncoder();

export async function readWorkflowFile(file: File): Promise<WorkflowDefinition> {
    const value = await readJson(file);
    if (!isPackage(value, 'keiai.workflow') || !isRecord(value.workflow)) {
        throw invalidPackage('workflow');
    }

    return readWorkflow(value.workflow);
}

export function writeWorkflowFile(workflow: WorkflowDefinition): Uint8Array {
    validateWorkflow(workflow);
    const pkg: KeiWorkflowPackageV1 = {
        version: 1,
        kind: 'keiai.workflow',
        workflow
    };
    return writeJson(pkg);
}

export async function readAgentFile(file: File): Promise<AgentConfiguration> {
    const value = await readJson(file);
    if (!isPackage(value, 'keiai.agent') || !isRecord(value.agent)) {
        throw invalidPackage('agent');
    }

    return readAgentConfiguration(value.agent);
}

export function writeAgentFile(agent: AgentNode): Uint8Array {
    const pkg: KeiAgentPackageV1 = {
        version: 1,
        kind: 'keiai.agent',
        agent: toAgentConfiguration(agent)
    };
    return writeJson(pkg);
}

function readWorkflow(value: Record<string, unknown>): WorkflowDefinition {
    if (!isRecord(value.nodes)) throw invalidPackage('workflow');

    for (const [id, node] of Object.entries(value.nodes)) {
        if (
            !isRecord(node) ||
            node.id !== id ||
            typeof node.class !== 'string' ||
            !(node.class in WORKFLOW_NODE_DEFINITIONS) ||
            !isRecord(node.inputs) ||
            !isRecord(node.inputValues)
        ) {
            throw invalidPackage('workflow');
        }
        if (node.class === 'Agent') assertAgentConfiguration(node);
    }

    const workflow = normalizeWorkflow(value as unknown as WorkflowDefinition);
    validateWorkflow(workflow);
    return workflow;
}

function readAgentConfiguration(value: Record<string, unknown>): AgentConfiguration {
    assertAgentConfiguration(value);
    const slotNames = value.slotNames as Record<string, string>;
    const defaultNode = createDefaultWorkflowNode('Agent', 'agent') as AgentNode;
    const inputs = {
        stream: null,
        ...Object.fromEntries(Object.keys(slotNames).map((inputId) => [inputId, null]))
    };
    const workflow = normalizeWorkflow({
        nodes: {
            agent: {
                ...defaultNode,
                ...value,
                id: 'agent',
                class: 'Agent',
                position: { x: 0, y: 0 },
                inputs
            } as AgentNode
        }
    });
    validateWorkflow(workflow);
    return toAgentConfiguration(workflow.nodes.agent as AgentNode);
}

function assertAgentConfiguration(value: Record<string, unknown>): void {
    if (
        typeof value.name !== 'string' ||
        typeof value.llmType !== 'string' ||
        !Array.isArray(value.toolIds) ||
        !value.toolIds.every((toolId) => typeof toolId === 'string') ||
        !isRecord(value.promptBlocks) ||
        !isRecord(value.slotNames) ||
        !isRecord(value.inputValues) ||
        !isFiniteNumber(value.maxContext) ||
        !isFiniteNumber(value.maxResponse) ||
        !isFiniteNumber(value.lorebookRatio) ||
        !isFiniteNumber(value.memoryRatio) ||
        !isFiniteNumber(value.lorebookScanDepth) ||
        !Object.values(value.slotNames).every((name) => typeof name === 'string') ||
        !Object.values(value.inputValues).every(isWorkflowValue) ||
        !Object.entries(value.promptBlocks).every(
            ([id, block]) =>
                isRecord(block) &&
                block.id === id &&
                (block.type === 'message' || block.type === 'history' || block.type === 'lorebook')
        )
    ) {
        throw invalidPackage('agent');
    }
}

function toAgentConfiguration(agent: AgentNode): AgentConfiguration {
    return structuredClone({
        name: agent.name,
        llmType: agent.llmType,
        toolIds: agent.toolIds,
        promptBlocks: agent.promptBlocks,
        maxContext: agent.maxContext,
        maxResponse: agent.maxResponse,
        lorebookRatio: agent.lorebookRatio,
        memoryRatio: agent.memoryRatio,
        lorebookScanDepth: agent.lorebookScanDepth,
        slotNames: agent.slotNames,
        inputValues: agent.inputValues
    });
}

async function readJson(file: File): Promise<unknown> {
    try {
        return JSON.parse(await file.text()) as unknown;
    } catch (error) {
        throw new AppError('INVALID_INPUT', `Invalid JSON file: ${file.name}`, error);
    }
}

function writeJson(value: KeiWorkflowPackageV1 | KeiAgentPackageV1): Uint8Array {
    return TEXT_ENCODER.encode(JSON.stringify(value, null, 2));
}

function isPackage(
    value: unknown,
    kind: KeiWorkflowPackageV1['kind'] | KeiAgentPackageV1['kind']
): value is Record<string, unknown> {
    return isRecord(value) && value.version === 1 && value.kind === kind;
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isWorkflowValue(value: unknown): value is WorkflowValue {
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function invalidPackage(kind: 'workflow' | 'agent'): AppError {
    return new AppError('INVALID_INPUT', `Invalid KeiAI ${kind} file`);
}
