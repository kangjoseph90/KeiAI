import type {
    AgentNode,
    BooleanLogicNode,
    BooleanNode,
    BooleanNotNode,
    CatchNode,
    FileReadNode,
    FileWriteNode,
    GateNode,
    GetChatVarNode,
    GetGlobalVarNode,
    GetToggleNode,
    NumberCompareNode,
    NumberMathNode,
    NumberNode,
    OutputNode,
    SetChatVarNode,
    SetGlobalVarNode,
    SetToggleNode,
    StringConcatNode,
    StringIncludesNode,
    StringLengthNode,
    StringNode,
    StringRegexReplaceNode,
    StringReplaceNode,
    TemplateNode,
    ThrowNode,
    ToBooleanNode,
    ToNumberNode,
    UngateNode,
    WorkflowNode,
    WorkflowNodeClass,
    WorkflowPortType
} from './types';

export type WorkflowNodeCategory =
    | 'agent'
    | 'string'
    | 'number'
    | 'boolean'
    | 'variable'
    | 'flow'
    | 'file'
    | 'result';

export const WORKFLOW_NODE_CATEGORY_ORDER: WorkflowNodeCategory[] = [
    'agent',
    'string',
    'number',
    'boolean',
    'variable',
    'flow',
    'file',
    'result'
];

export const WORKFLOW_NODE_CATEGORY_LABELS = {
    agent: 'Agent',
    string: 'String',
    number: 'Number',
    boolean: 'Boolean',
    variable: 'Variable',
    flow: 'Flow',
    file: 'File',
    result: 'Result'
} satisfies Record<WorkflowNodeCategory, string>;

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

const STRING_OUTPUT = { 0: { name: 'content', type: 'string' } } as const;
const RESULT_STRING_OUTPUT = { 0: { name: 'result', type: 'string' } } as const;
const RESULT_BOOLEAN_OUTPUT = { 0: { name: 'result', type: 'boolean' } } as const;
const STREAM_INPUT = { name: 'Stream', type: 'boolean', required: false } as const;

export const STRING_NODE_DEFINITION: WorkflowNodeDefinition<StringNode> = {
    class: 'String',
    label: 'String',
    category: 'string',
    inputs: {},
    outputs: STRING_OUTPUT,
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
    category: 'number',
    inputs: {},
    outputs: { 0: { name: 'value', type: 'number' } },
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
    category: 'boolean',
    inputs: {},
    outputs: { 0: { name: 'value', type: 'boolean' } },
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

export const TEMPLATE_NODE_DEFINITION: WorkflowNodeDefinition<TemplateNode> = {
    class: 'Template',
    label: 'Template',
    category: 'string',
    inputs: {
        content: { name: 'Content', type: 'string', required: true },
        stream: STREAM_INPUT
    },
    outputs: RESULT_STRING_OUTPUT,
    createDefault: (id) => ({
        id,
        name: 'Template',
        class: 'Template',
        position: { x: 0, y: 0 },
        inputs: { content: null, stream: null },
        inputValues: { content: '', stream: false }
    })
};

export const GET_TOGGLE_NODE_DEFINITION: WorkflowNodeDefinition<GetToggleNode> = {
    class: 'GetToggle',
    label: 'Get Toggle',
    category: 'variable',
    inputs: { name: { name: 'Name', type: 'string', required: true } },
    outputs: STRING_OUTPUT,
    createDefault: (id) => ({
        id,
        name: 'Get Toggle',
        class: 'GetToggle',
        position: { x: 0, y: 0 },
        inputs: { name: null },
        inputValues: { name: '' }
    })
};

export const SET_TOGGLE_NODE_DEFINITION: WorkflowNodeDefinition<SetToggleNode> = {
    class: 'SetToggle',
    label: 'Set Toggle',
    category: 'variable',
    inputs: {
        content: { name: 'Content', type: 'string', required: true },
        name: { name: 'Name', type: 'string', required: true }
    },
    outputs: {},
    createDefault: (id) => ({
        id,
        name: 'Set Toggle',
        class: 'SetToggle',
        position: { x: 0, y: 0 },
        inputs: { content: null, name: null },
        inputValues: { content: '', name: '' }
    })
};

export const GET_GLOBAL_VAR_NODE_DEFINITION: WorkflowNodeDefinition<GetGlobalVarNode> = {
    class: 'GetGlobalVar',
    label: 'Get Global Var',
    category: 'variable',
    inputs: { name: { name: 'Name', type: 'string', required: true } },
    outputs: STRING_OUTPUT,
    createDefault: (id) => ({
        id,
        name: 'Get Global Var',
        class: 'GetGlobalVar',
        position: { x: 0, y: 0 },
        inputs: { name: null },
        inputValues: { name: '' }
    })
};

export const SET_GLOBAL_VAR_NODE_DEFINITION: WorkflowNodeDefinition<SetGlobalVarNode> = {
    class: 'SetGlobalVar',
    label: 'Set Global Var',
    category: 'variable',
    inputs: {
        content: { name: 'Content', type: 'string', required: true },
        name: { name: 'Name', type: 'string', required: true }
    },
    outputs: {},
    createDefault: (id) => ({
        id,
        name: 'Set Global Var',
        class: 'SetGlobalVar',
        position: { x: 0, y: 0 },
        inputs: { content: null, name: null },
        inputValues: { content: '', name: '' }
    })
};

export const GET_CHAT_VAR_NODE_DEFINITION: WorkflowNodeDefinition<GetChatVarNode> = {
    class: 'GetChatVar',
    label: 'Get Chat Var',
    category: 'variable',
    inputs: { name: { name: 'Name', type: 'string', required: true } },
    outputs: STRING_OUTPUT,
    createDefault: (id) => ({
        id,
        name: 'Get Chat Var',
        class: 'GetChatVar',
        position: { x: 0, y: 0 },
        inputs: { name: null },
        inputValues: { name: '' }
    })
};

export const SET_CHAT_VAR_NODE_DEFINITION: WorkflowNodeDefinition<SetChatVarNode> = {
    class: 'SetChatVar',
    label: 'Set Chat Var',
    category: 'variable',
    inputs: {
        content: { name: 'Content', type: 'string', required: true },
        name: { name: 'Name', type: 'string', required: true }
    },
    outputs: {},
    createDefault: (id) => ({
        id,
        name: 'Set Chat Var',
        class: 'SetChatVar',
        position: { x: 0, y: 0 },
        inputs: { content: null, name: null },
        inputValues: { content: '', name: '' }
    })
};

export const TO_BOOLEAN_NODE_DEFINITION: WorkflowNodeDefinition<ToBooleanNode> = {
    class: 'ToBoolean',
    label: 'To Boolean',
    category: 'boolean',
    inputs: {
        content: { name: 'Content', type: 'string', required: true },
        stream: STREAM_INPUT
    },
    outputs: RESULT_BOOLEAN_OUTPUT,
    createDefault: (id) => ({
        id,
        name: 'To Boolean',
        class: 'ToBoolean',
        position: { x: 0, y: 0 },
        inputs: { content: null, stream: null },
        inputValues: { content: '', stream: false }
    })
};

export const TO_NUMBER_NODE_DEFINITION: WorkflowNodeDefinition<ToNumberNode> = {
    class: 'ToNumber',
    label: 'To Number',
    category: 'number',
    inputs: {
        content: { name: 'Content', type: 'string', required: true },
        stream: STREAM_INPUT
    },
    outputs: { 0: { name: 'result', type: 'number' } },
    createDefault: (id) => ({
        id,
        name: 'To Number',
        class: 'ToNumber',
        position: { x: 0, y: 0 },
        inputs: { content: null, stream: null },
        inputValues: { content: '', stream: false }
    })
};

export const CATCH_NODE_DEFINITION: WorkflowNodeDefinition<CatchNode> = {
    class: 'Catch',
    label: 'Catch',
    category: 'flow',
    inputs: {
        try: { name: 'Try', type: 'string', required: true },
        fallback: { name: 'Fallback', type: 'string', required: true }
    },
    outputs: {
        0: { name: 'result', type: 'string' },
        1: { name: 'isError', type: 'boolean' }
    },
    createDefault: (id) => ({
        id,
        name: 'Catch',
        class: 'Catch',
        position: { x: 0, y: 0 },
        inputs: { try: null, fallback: null },
        inputValues: { try: '', fallback: '' }
    })
};

export const THROW_NODE_DEFINITION: WorkflowNodeDefinition<ThrowNode> = {
    class: 'Throw',
    label: 'Throw',
    category: 'flow',
    inputs: { condition: { name: 'Condition', type: 'boolean', required: true } },
    outputs: { 0: { name: 'try', type: 'boolean' } },
    createDefault: (id) => ({
        id,
        name: 'Throw',
        class: 'Throw',
        position: { x: 0, y: 0 },
        inputs: { condition: null },
        inputValues: { condition: false }
    })
};

export const CONCAT_NODE_DEFINITION: WorkflowNodeDefinition<StringConcatNode> = {
    class: 'Concat',
    label: 'String Concat',
    category: 'string',
    inputs: {
        a: { name: 'A', type: 'string', required: false },
        b: { name: 'B', type: 'string', required: false },
        separator: { name: 'Separator', type: 'string', required: false },
        stream: STREAM_INPUT
    },
    outputs: RESULT_STRING_OUTPUT,
    createDefault: (id) => ({
        id,
        name: 'String Concat',
        class: 'Concat',
        position: { x: 0, y: 0 },
        inputs: { a: null, b: null, separator: null, stream: null },
        inputValues: { a: '', b: '', separator: '', stream: false }
    })
};

export const STRING_LENGTH_NODE_DEFINITION: WorkflowNodeDefinition<StringLengthNode> = {
    class: 'StringLength',
    label: 'String Length',
    category: 'string',
    inputs: {
        value: { name: 'Value', type: 'string', required: false },
        stream: STREAM_INPUT
    },
    outputs: { 0: { name: 'length', type: 'number' } },
    createDefault: (id) => ({
        id,
        name: 'String Length',
        class: 'StringLength',
        position: { x: 0, y: 0 },
        inputs: { value: null, stream: null },
        inputValues: { value: '', stream: false }
    })
};

export const STRING_INCLUDES_NODE_DEFINITION: WorkflowNodeDefinition<StringIncludesNode> = {
    class: 'StringIncludes',
    label: 'String Includes',
    category: 'string',
    inputs: {
        text: { name: 'Text', type: 'string', required: false },
        search: { name: 'Search', type: 'string', required: false },
        stream: STREAM_INPUT
    },
    outputs: RESULT_BOOLEAN_OUTPUT,
    createDefault: (id) => ({
        id,
        name: 'String Includes',
        class: 'StringIncludes',
        position: { x: 0, y: 0 },
        caseSensitive: false,
        inputs: { text: null, search: null, stream: null },
        inputValues: { text: '', search: '', stream: false }
    })
};

export const STRING_REPLACE_NODE_DEFINITION: WorkflowNodeDefinition<StringReplaceNode> = {
    class: 'StringReplace',
    label: 'String Replace',
    category: 'string',
    inputs: {
        text: { name: 'Text', type: 'string', required: false },
        search: { name: 'Search', type: 'string', required: false },
        replace: { name: 'Replace', type: 'string', required: false },
        stream: STREAM_INPUT
    },
    outputs: RESULT_STRING_OUTPUT,
    createDefault: (id) => ({
        id,
        name: 'String Replace',
        class: 'StringReplace',
        position: { x: 0, y: 0 },
        inputs: { text: null, search: null, replace: null, stream: null },
        inputValues: { text: '', search: '', replace: '', stream: false }
    })
};

export const STRING_REGEX_REPLACE_NODE_DEFINITION: WorkflowNodeDefinition<StringRegexReplaceNode> =
    {
        class: 'StringRegexReplace',
        label: 'String Regex Replace',
        category: 'string',
        inputs: {
            text: { name: 'Text', type: 'string', required: false },
            regex: { name: 'Regex', type: 'string', required: false },
            replace: { name: 'Replace', type: 'string', required: false },
            stream: STREAM_INPUT
        },
        outputs: RESULT_STRING_OUTPUT,
        createDefault: (id) => ({
            id,
            name: 'String Regex Replace',
            class: 'StringRegexReplace',
            position: { x: 0, y: 0 },
            flags: 'g',
            inputs: { text: null, regex: null, replace: null, stream: null },
            inputValues: { text: '', regex: '', replace: '', stream: false }
        })
    };

export const NUMBER_MATH_NODE_DEFINITION: WorkflowNodeDefinition<NumberMathNode> = {
    class: 'NumberMath',
    label: 'Number Math',
    category: 'number',
    inputs: {
        a: { name: 'A', type: 'number', required: false },
        b: { name: 'B', type: 'number', required: false },
        stream: STREAM_INPUT
    },
    outputs: { 0: { name: 'value', type: 'number' } },
    createDefault: (id) => ({
        id,
        name: 'Number Math',
        class: 'NumberMath',
        position: { x: 0, y: 0 },
        operator: 'add',
        inputs: { a: null, b: null, stream: null },
        inputValues: { a: 0, b: 0, stream: false }
    })
};

export const NUMBER_COMPARE_NODE_DEFINITION: WorkflowNodeDefinition<NumberCompareNode> = {
    class: 'NumberCompare',
    label: 'Number Compare',
    category: 'number',
    inputs: {
        a: { name: 'A', type: 'number', required: false },
        b: { name: 'B', type: 'number', required: false },
        stream: STREAM_INPUT
    },
    outputs: RESULT_BOOLEAN_OUTPUT,
    createDefault: (id) => ({
        id,
        name: 'Number Compare',
        class: 'NumberCompare',
        position: { x: 0, y: 0 },
        operator: 'greaterThan',
        inputs: { a: null, b: null, stream: null },
        inputValues: { a: 0, b: 0, stream: false }
    })
};

export const BOOLEAN_LOGIC_NODE_DEFINITION: WorkflowNodeDefinition<BooleanLogicNode> = {
    class: 'BooleanLogic',
    label: 'Boolean Logic',
    category: 'boolean',
    inputs: {
        a: { name: 'A', type: 'boolean', required: false },
        b: { name: 'B', type: 'boolean', required: false },
        stream: STREAM_INPUT
    },
    outputs: RESULT_BOOLEAN_OUTPUT,
    createDefault: (id) => ({
        id,
        name: 'Boolean Logic',
        class: 'BooleanLogic',
        position: { x: 0, y: 0 },
        operator: 'and',
        inputs: { a: null, b: null, stream: null },
        inputValues: { a: false, b: false, stream: false }
    })
};

export const BOOLEAN_NOT_NODE_DEFINITION: WorkflowNodeDefinition<BooleanNotNode> = {
    class: 'BooleanNot',
    label: 'Boolean Not',
    category: 'boolean',
    inputs: {
        value: { name: 'Value', type: 'boolean', required: false },
        stream: STREAM_INPUT
    },
    outputs: RESULT_BOOLEAN_OUTPUT,
    createDefault: (id) => ({
        id,
        name: 'Boolean Not',
        class: 'BooleanNot',
        position: { x: 0, y: 0 },
        inputs: { value: null, stream: null },
        inputValues: { value: false, stream: false }
    })
};

export const GATE_NODE_DEFINITION: WorkflowNodeDefinition<GateNode> = {
    class: 'Gate',
    label: 'Gate',
    category: 'flow',
    inputs: { condition: { name: 'Condition', type: 'boolean', required: false } },
    outputs: { 0: { name: 'gate', type: 'boolean' } },
    createDefault: (id) => ({
        id,
        name: 'Gate',
        class: 'Gate',
        position: { x: 0, y: 0 },
        inputs: { condition: null },
        inputValues: { condition: false }
    })
};

export const UNGATE_NODE_DEFINITION: WorkflowNodeDefinition<UngateNode> = {
    class: 'Ungate',
    label: 'Ungate',
    category: 'flow',
    inputs: {
        gate: { name: 'Gate', type: 'string', required: true },
        fallback: { name: 'Fallback', type: 'string', required: true }
    },
    outputs: {
        0: { name: 'result', type: 'string' },
        1: { name: 'isSkip', type: 'boolean' }
    },
    createDefault: (id) => ({
        id,
        name: 'Ungate',
        class: 'Ungate',
        position: { x: 0, y: 0 },
        inputs: { gate: null, fallback: null },
        inputValues: { gate: '', fallback: '' }
    })
};

export const OUTPUT_NODE_DEFINITION: WorkflowNodeDefinition<OutputNode> = {
    class: 'Output',
    label: 'Output',
    category: 'result',
    inputs: { content: { name: 'Content', type: 'string', required: true } },
    outputs: {},
    createDefault: (id) => ({
        id,
        name: 'Output',
        class: 'Output',
        position: { x: 0, y: 0 },
        inputs: { content: null },
        inputValues: {}
    })
};

export const FILE_READ_NODE_DEFINITION: WorkflowNodeDefinition<FileReadNode> = {
    class: 'FileRead',
    label: 'File Read',
    category: 'file',
    inputs: { path: { name: 'Path', type: 'string', required: true } },
    outputs: STRING_OUTPUT,
    createDefault: (id) => ({
        id,
        name: 'File Read',
        class: 'FileRead',
        position: { x: 0, y: 0 },
        namespace: 'global',
        inputs: { path: null },
        inputValues: { path: '' }
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
        inputs: { path: null, content: null },
        inputValues: { path: '', content: '' }
    })
};

export const AGENT_NODE_DEFINITION: WorkflowNodeDefinition<AgentNode> = {
    class: 'Agent',
    label: 'Agent',
    category: 'agent',
    inputs: { stream: STREAM_INPUT },
    outputs: STRING_OUTPUT,
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
        inputs: { stream: null },
        inputValues: { stream: true }
    })
};

export const WORKFLOW_NODE_DEFINITIONS = {
    String: STRING_NODE_DEFINITION,
    Number: NUMBER_NODE_DEFINITION,
    Boolean: BOOLEAN_NODE_DEFINITION,
    Template: TEMPLATE_NODE_DEFINITION,
    GetToggle: GET_TOGGLE_NODE_DEFINITION,
    SetToggle: SET_TOGGLE_NODE_DEFINITION,
    GetGlobalVar: GET_GLOBAL_VAR_NODE_DEFINITION,
    SetGlobalVar: SET_GLOBAL_VAR_NODE_DEFINITION,
    GetChatVar: GET_CHAT_VAR_NODE_DEFINITION,
    SetChatVar: SET_CHAT_VAR_NODE_DEFINITION,
    ToBoolean: TO_BOOLEAN_NODE_DEFINITION,
    ToNumber: TO_NUMBER_NODE_DEFINITION,
    Catch: CATCH_NODE_DEFINITION,
    Throw: THROW_NODE_DEFINITION,
    Concat: CONCAT_NODE_DEFINITION,
    StringLength: STRING_LENGTH_NODE_DEFINITION,
    StringIncludes: STRING_INCLUDES_NODE_DEFINITION,
    StringReplace: STRING_REPLACE_NODE_DEFINITION,
    StringRegexReplace: STRING_REGEX_REPLACE_NODE_DEFINITION,
    NumberMath: NUMBER_MATH_NODE_DEFINITION,
    NumberCompare: NUMBER_COMPARE_NODE_DEFINITION,
    BooleanLogic: BOOLEAN_LOGIC_NODE_DEFINITION,
    BooleanNot: BOOLEAN_NOT_NODE_DEFINITION,
    Gate: GATE_NODE_DEFINITION,
    Ungate: UNGATE_NODE_DEFINITION,
    Output: OUTPUT_NODE_DEFINITION,
    FileRead: FILE_READ_NODE_DEFINITION,
    FileWrite: FILE_WRITE_NODE_DEFINITION,
    Agent: AGENT_NODE_DEFINITION
} satisfies Record<WorkflowNodeClass, WorkflowNodeDefinition<WorkflowNode>>;

export function createDefaultWorkflowNode(nodeClass: WorkflowNodeClass, id: string): WorkflowNode {
    return WORKFLOW_NODE_DEFINITIONS[nodeClass].createDefault(id);
}

export function getWorkflowInputPortDefinition(
    node: WorkflowNode,
    inputId: string
): WorkflowPortDefinition | undefined {
    if (node.class === 'Agent' && inputId in node.slotNames) {
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
