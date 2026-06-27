import type {
    AgentNode,
    BooleanLogicNode,
    BooleanNode,
    BooleanNotNode,
    FileReadNode,
    FileWriteNode,
    NumberCompareNode,
    NumberMathNode,
    NumberNode,
    OutputNode,
    StringConcatNode,
    StringIncludesNode,
    StringLengthNode,
    StringNode,
    WorkflowNode,
    WorkflowNodeClass,
    WorkflowPortType
} from './types';

export type WorkflowNodeCategory = 'agent' | 'operator' | 'file' | 'output';

export interface WorkflowPortDefinition {
    name: string;
    type: WorkflowPortType;
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
        0: { name: 'content', type: 'string' }
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

export const NUMBER_NODE_DEFINITION: WorkflowNodeDefinition<NumberNode> = {
    class: 'Number',
    label: 'Number',
    category: 'operator',
    inputs: {},
    outputs: {
        0: { name: 'value', type: 'number' }
    },
    createDefault: (id) => ({
        id,
        name: 'Number',
        class: 'Number',
        position: { x: 0, y: 0 },
        value: 0,
        inputs: {},
        inputValues: {}
    })
};

export const BOOLEAN_NODE_DEFINITION: WorkflowNodeDefinition<BooleanNode> = {
    class: 'Boolean',
    label: 'Boolean',
    category: 'operator',
    inputs: {},
    outputs: {
        0: { name: 'value', type: 'boolean' }
    },
    createDefault: (id) => ({
        id,
        name: 'Boolean',
        class: 'Boolean',
        position: { x: 0, y: 0 },
        value: false,
        inputs: {},
        inputValues: {}
    })
};

export const CONCAT_NODE_DEFINITION: WorkflowNodeDefinition<StringConcatNode> = {
    class: 'Concat',
    label: 'Concat',
    category: 'operator',
    inputs: {
        a: { name: 'A', type: 'string', required: false },
        b: { name: 'B', type: 'string', required: false },
        separator: { name: 'Separator', type: 'string', required: false }
    },
    outputs: {
        0: { name: 'content', type: 'string' }
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

export const STRING_LENGTH_NODE_DEFINITION: WorkflowNodeDefinition<StringLengthNode> = {
    class: 'StringLength',
    label: 'String Length',
    category: 'operator',
    inputs: {
        value: { name: 'Value', type: 'string', required: false }
    },
    outputs: {
        0: { name: 'length', type: 'number' }
    },
    createDefault: (id) => ({
        id,
        name: 'String Length',
        class: 'StringLength',
        position: { x: 0, y: 0 },
        inputs: {
            value: null
        },
        inputValues: {
            value: ''
        }
    })
};

export const STRING_INCLUDES_NODE_DEFINITION: WorkflowNodeDefinition<StringIncludesNode> = {
    class: 'StringIncludes',
    label: 'String Includes',
    category: 'operator',
    inputs: {
        text: { name: 'Text', type: 'string', required: false },
        search: { name: 'Search', type: 'string', required: false }
    },
    outputs: {
        0: { name: 'result', type: 'boolean' }
    },
    createDefault: (id) => ({
        id,
        name: 'String Includes',
        class: 'StringIncludes',
        position: { x: 0, y: 0 },
        caseSensitive: false,
        inputs: {
            text: null,
            search: null
        },
        inputValues: {
            text: '',
            search: ''
        }
    })
};

export const NUMBER_MATH_NODE_DEFINITION: WorkflowNodeDefinition<NumberMathNode> = {
    class: 'NumberMath',
    label: 'Number Math',
    category: 'operator',
    inputs: {
        a: { name: 'A', type: 'number', required: false },
        b: { name: 'B', type: 'number', required: false }
    },
    outputs: {
        0: { name: 'value', type: 'number' }
    },
    createDefault: (id) => ({
        id,
        name: 'Number Math',
        class: 'NumberMath',
        position: { x: 0, y: 0 },
        operator: 'add',
        inputs: {
            a: null,
            b: null
        },
        inputValues: {
            a: 0,
            b: 0
        }
    })
};

export const NUMBER_COMPARE_NODE_DEFINITION: WorkflowNodeDefinition<NumberCompareNode> = {
    class: 'NumberCompare',
    label: 'Number Compare',
    category: 'operator',
    inputs: {
        a: { name: 'A', type: 'number', required: false },
        b: { name: 'B', type: 'number', required: false }
    },
    outputs: {
        0: { name: 'result', type: 'boolean' }
    },
    createDefault: (id) => ({
        id,
        name: 'Number Compare',
        class: 'NumberCompare',
        position: { x: 0, y: 0 },
        operator: 'greaterThan',
        inputs: {
            a: null,
            b: null
        },
        inputValues: {
            a: 0,
            b: 0
        }
    })
};

export const BOOLEAN_LOGIC_NODE_DEFINITION: WorkflowNodeDefinition<BooleanLogicNode> = {
    class: 'BooleanLogic',
    label: 'Boolean Logic',
    category: 'operator',
    inputs: {
        a: { name: 'A', type: 'boolean', required: false },
        b: { name: 'B', type: 'boolean', required: false }
    },
    outputs: {
        0: { name: 'result', type: 'boolean' }
    },
    createDefault: (id) => ({
        id,
        name: 'Boolean Logic',
        class: 'BooleanLogic',
        position: { x: 0, y: 0 },
        operator: 'and',
        inputs: {
            a: null,
            b: null
        },
        inputValues: {
            a: false,
            b: false
        }
    })
};

export const BOOLEAN_NOT_NODE_DEFINITION: WorkflowNodeDefinition<BooleanNotNode> = {
    class: 'BooleanNot',
    label: 'Boolean Not',
    category: 'operator',
    inputs: {
        value: { name: 'Value', type: 'boolean', required: false }
    },
    outputs: {
        0: { name: 'result', type: 'boolean' }
    },
    createDefault: (id) => ({
        id,
        name: 'Boolean Not',
        class: 'BooleanNot',
        position: { x: 0, y: 0 },
        inputs: {
            value: null
        },
        inputValues: {
            value: false
        }
    })
};

export const OUTPUT_NODE_DEFINITION: WorkflowNodeDefinition<OutputNode> = {
    class: 'Output',
    label: 'Output',
    category: 'output',
    inputs: {
        content: { name: 'Content', type: 'string', required: true }
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
        path: { name: 'Path', type: 'string', required: true }
    },
    outputs: {
        0: { name: 'content', type: 'string' }
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
        path: { name: 'Path', type: 'string', required: true },
        content: { name: 'Content', type: 'string', required: true }
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
        0: { name: 'content', type: 'string' }
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
    Number: NUMBER_NODE_DEFINITION,
    Boolean: BOOLEAN_NODE_DEFINITION,
    Concat: CONCAT_NODE_DEFINITION,
    StringLength: STRING_LENGTH_NODE_DEFINITION,
    StringIncludes: STRING_INCLUDES_NODE_DEFINITION,
    NumberMath: NUMBER_MATH_NODE_DEFINITION,
    NumberCompare: NUMBER_COMPARE_NODE_DEFINITION,
    BooleanLogic: BOOLEAN_LOGIC_NODE_DEFINITION,
    BooleanNot: BOOLEAN_NOT_NODE_DEFINITION,
    Output: OUTPUT_NODE_DEFINITION,
    FileRead: FILE_READ_NODE_DEFINITION,
    FileWrite: FILE_WRITE_NODE_DEFINITION,
    Agent: AGENT_NODE_DEFINITION
} satisfies Record<WorkflowNodeClass, WorkflowNodeDefinition<WorkflowNode>>;

export function createDefaultWorkflowNode(nodeClass: WorkflowNodeClass, id: string): WorkflowNode {
    switch (nodeClass) {
        case 'String':
            return STRING_NODE_DEFINITION.createDefault(id);
        case 'Number':
            return NUMBER_NODE_DEFINITION.createDefault(id);
        case 'Boolean':
            return BOOLEAN_NODE_DEFINITION.createDefault(id);
        case 'Concat':
            return CONCAT_NODE_DEFINITION.createDefault(id);
        case 'StringLength':
            return STRING_LENGTH_NODE_DEFINITION.createDefault(id);
        case 'StringIncludes':
            return STRING_INCLUDES_NODE_DEFINITION.createDefault(id);
        case 'NumberMath':
            return NUMBER_MATH_NODE_DEFINITION.createDefault(id);
        case 'NumberCompare':
            return NUMBER_COMPARE_NODE_DEFINITION.createDefault(id);
        case 'BooleanLogic':
            return BOOLEAN_LOGIC_NODE_DEFINITION.createDefault(id);
        case 'BooleanNot':
            return BOOLEAN_NOT_NODE_DEFINITION.createDefault(id);
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

export function getWorkflowInputPortDefinition(
    node: WorkflowNode,
    inputId: string
): WorkflowPortDefinition | undefined {
    if (node.class === 'Agent' && inputId in node.inputs) {
        return { name: node.slotNames[inputId] ?? inputId, type: 'string', required: false };
    }
    return WORKFLOW_NODE_DEFINITIONS[node.class].inputs[inputId];
}

export function getWorkflowOutputPortDefinition(
    node: WorkflowNode,
    outputId: number
): WorkflowPortDefinition | undefined {
    return WORKFLOW_NODE_DEFINITIONS[node.class].outputs[outputId];
}

export function canConnectWorkflowPortTypes(
    sourceType: WorkflowPortType,
    targetType: WorkflowPortType
): boolean {
    return sourceType === targetType || targetType === 'string';
}
