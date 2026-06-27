import type {
    AgentNode,
    FileReadNode,
    FileWriteNode,
    OutputNode,
    StringConcatNode,
    StringNode,
    WorkflowNode,
    WorkflowNodeClass
} from './types';

export type WorkflowNodeCategory = 'agent' | 'operator' | 'file' | 'output';

export interface WorkflowPortDefinition {
    name: string;
    required?: boolean;
}

export interface WorkflowNodeDefinition<TNode extends WorkflowNode> {
    class: TNode['class'];
    label: string;
    category: WorkflowNodeCategory;
    inputs: Record<string, WorkflowPortDefinition>;
    outputs: Record<number, WorkflowPortDefinition>;
    createDefault: (id: string) => TNode;
}

export const STRING_NODE_DEFINITION: WorkflowNodeDefinition<StringNode> = {
    class: 'String',
    label: 'String',
    category: 'operator',
    inputs: {},
    outputs: {
        0: { name: 'content' }
    },
    createDefault: (id) => ({
        id,
        name: 'String',
        class: 'String',
        position: { x: 0, y: 0 },
        content: '',
        inputs: {},
        inputValues: {}
    })
};

export const CONCAT_NODE_DEFINITION: WorkflowNodeDefinition<StringConcatNode> = {
    class: 'Concat',
    label: 'Concat',
    category: 'operator',
    inputs: {
        a: { name: 'A', required: false },
        b: { name: 'B', required: false },
        separator: { name: 'Separator', required: false }
    },
    outputs: {
        0: { name: 'content' }
    },
    createDefault: (id) => ({
        id,
        name: 'Concat',
        class: 'Concat',
        position: { x: 0, y: 0 },
        inputs: {
            a: null,
            b: null,
            separator: null
        },
        inputValues: {
            a: '',
            b: '',
            separator: ''
        }
    })
};

export const OUTPUT_NODE_DEFINITION: WorkflowNodeDefinition<OutputNode> = {
    class: 'Output',
    label: 'Output',
    category: 'output',
    inputs: {
        content: { name: 'Content', required: true }
    },
    outputs: {},
    createDefault: (id) => ({
        id,
        name: 'Output',
        class: 'Output',
        position: { x: 0, y: 0 },
        inputs: {
            content: null
        },
        inputValues: {}
    })
};

export const FILE_READ_NODE_DEFINITION: WorkflowNodeDefinition<FileReadNode> = {
    class: 'FileRead',
    label: 'File Read',
    category: 'file',
    inputs: {
        path: { name: 'Path', required: true }
    },
    outputs: {
        0: { name: 'content' }
    },
    createDefault: (id) => ({
        id,
        name: 'File Read',
        class: 'FileRead',
        position: { x: 0, y: 0 },
        namespace: 'global',
        inputs: {
            path: null
        },
        inputValues: {
            path: ''
        }
    })
};

export const FILE_WRITE_NODE_DEFINITION: WorkflowNodeDefinition<FileWriteNode> = {
    class: 'FileWrite',
    label: 'File Write',
    category: 'file',
    inputs: {
        path: { name: 'Path', required: true },
        content: { name: 'Content', required: true }
    },
    outputs: {},
    createDefault: (id) => ({
        id,
        name: 'File Write',
        class: 'FileWrite',
        position: { x: 0, y: 0 },
        namespace: 'global',
        inputs: {
            path: null,
            content: null
        },
        inputValues: {
            path: '',
            content: ''
        }
    })
};

export const AGENT_NODE_DEFINITION: WorkflowNodeDefinition<AgentNode> = {
    class: 'Agent',
    label: 'Agent',
    category: 'agent',
    inputs: {},
    outputs: {
        0: { name: 'content' }
    },
    createDefault: (id) => ({
        id,
        name: 'Agent',
        class: 'Agent',
        position: { x: 0, y: 0 },
        llmType: 'chat',
        promptBlocks: {},
        maxContext: 60000,
        maxResponse: 6000,
        lorebookRatio: 0.2,
        memoryRatio: 0.2,
        lorebookScanDepth: 5,
        slotNames: {},
        inputs: {},
        inputValues: {}
    })
};

export const WORKFLOW_NODE_DEFINITIONS = {
    String: STRING_NODE_DEFINITION,
    Concat: CONCAT_NODE_DEFINITION,
    Output: OUTPUT_NODE_DEFINITION,
    FileRead: FILE_READ_NODE_DEFINITION,
    FileWrite: FILE_WRITE_NODE_DEFINITION,
    Agent: AGENT_NODE_DEFINITION
} satisfies Record<WorkflowNodeClass, WorkflowNodeDefinition<WorkflowNode>>;

export function createDefaultWorkflowNode(nodeClass: WorkflowNodeClass, id: string): WorkflowNode {
    switch (nodeClass) {
        case 'String':
            return STRING_NODE_DEFINITION.createDefault(id);
        case 'Concat':
            return CONCAT_NODE_DEFINITION.createDefault(id);
        case 'Output':
            return OUTPUT_NODE_DEFINITION.createDefault(id);
        case 'FileRead':
            return FILE_READ_NODE_DEFINITION.createDefault(id);
        case 'FileWrite':
            return FILE_WRITE_NODE_DEFINITION.createDefault(id);
        case 'Agent':
            return AGENT_NODE_DEFINITION.createDefault(id);
    }
}
