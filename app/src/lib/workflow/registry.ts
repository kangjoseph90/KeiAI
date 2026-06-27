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
        content: '',
        inputs: {}
    })
};

export const CONCAT_NODE_DEFINITION: WorkflowNodeDefinition<StringConcatNode> = {
    class: 'Concat',
    label: 'Concat',
    category: 'operator',
    inputs: {
        a: { name: 'A', required: false },
        b: { name: 'B', required: false }
    },
    outputs: {
        0: { name: 'content' }
    },
    createDefault: (id) => ({
        id,
        name: 'Concat',
        class: 'Concat',
        separator: '',
        inputs: {
            a: null,
            b: null
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
    outputs: {
        0: { name: 'content' }
    },
    createDefault: (id) => ({
        id,
        name: 'Output',
        class: 'Output',
        inputs: {
            content: null
        }
    })
};

export const FILE_READ_NODE_DEFINITION: WorkflowNodeDefinition<FileReadNode> = {
    class: 'FileRead',
    label: 'File Read',
    category: 'file',
    inputs: {
        source: { name: 'Source', required: false }
    },
    outputs: {
        0: { name: 'content' }
    },
    createDefault: (id) => ({
        id,
        name: 'File Read',
        class: 'FileRead',
        source: '',
        scope: 'user',
        inputs: {
            source: null
        }
    })
};

export const FILE_WRITE_NODE_DEFINITION: WorkflowNodeDefinition<FileWriteNode> = {
    class: 'FileWrite',
    label: 'File Write',
    category: 'file',
    inputs: {
        source: { name: 'Source', required: false },
        content: { name: 'Content', required: true }
    },
    outputs: {
        0: { name: 'content' }
    },
    createDefault: (id) => ({
        id,
        name: 'File Write',
        class: 'FileWrite',
        source: '',
        scope: 'user',
        inputs: {
            source: null,
            content: null
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
        llmType: 'chat',
        promptBlocks: {},
        maxContext: 60000,
        maxResponse: 6000,
        lorebookRatio: 0.2,
        memoryRatio: 0.2,
        lorebookScanDepth: 5,
        inputs: {}
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
