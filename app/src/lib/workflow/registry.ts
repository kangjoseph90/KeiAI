import type {
    AgentNode,
    FilterAgentPartsNode,
    BooleanLogicNode,
    BooleanNode,
    BooleanNotNode,
    CatchNode,
    FileReadNode,
    FileWriteNode,
    GateNode,
    GetAudioAttachmentsNode,
    GetChatVarNode,
    GetHistoryNode,
    GetImageAttachmentsNode,
    GetToggleNode,
    GetTranslationNode,
    ImageGenerationNode,
    LogNode,
    SelectLastTextPartNode,
    NumberCompareNode,
    NumberMathNode,
    NumberNode,
    OutputNode,
    SetChatVarNode,
    SetAudioAttachmentsNode,
    SetHistoryNode,
    SetImageAttachmentsNode,
    SetTranslationNode,
    SinkNode,
    StringConcatNode,
    StringIncludesNode,
    StringLengthNode,
    StringNode,
    StringRegexReplaceNode,
    StringReplaceNode,
    STTNode,
    TemplateNode,
    TTSNode,
    ThrowIfNode,
    ToBooleanNode,
    ToNumberNode,
    UngateNode,
    SelectVisiblePartsNode,
    WorkflowNode,
    WorkflowNodeClass,
    WorkflowPortType
} from './types';

export type WorkflowNodeCategory =
    | 'agent'
    | 'history'
    | 'string'
    | 'number'
    | 'boolean'
    | 'variable'
    | 'flow'
    | 'file'
    | 'result';

export const WORKFLOW_NODE_CATEGORY_ORDER: WorkflowNodeCategory[] = [
    'agent',
    'history',
    'string',
    'number',
    'boolean',
    'variable',
    'flow',
    'file',
    'result'
];

export interface WorkflowPortDefinition {
    name: string;
    type: WorkflowPortType;
    required?: boolean;
    allowLiteral?: boolean;
}

export interface WorkflowNodeDefinition<TNode extends WorkflowNode> {
    class: TNode['class'];
    label: string;
    category: WorkflowNodeCategory;
    inputs: Record<string, WorkflowPortDefinition>;
    outputs: Record<number, WorkflowPortDefinition>;
    isSink?: boolean;
    createDefault: (id: string) => Omit<TNode, 'collapsed'>;
}

const STRING_OUTPUT = { 0: { name: 'content', type: 'string' } } as const;
const RESULT_STRING_OUTPUT = { 0: { name: 'result', type: 'string' } } as const;
const RESULT_BOOLEAN_OUTPUT = { 0: { name: 'result', type: 'boolean' } } as const;
const STREAM_INPUT = { name: 'Stream', type: 'boolean', required: false } as const;

const STRING_NODE_DEFINITION: WorkflowNodeDefinition<StringNode> = {
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

const NUMBER_NODE_DEFINITION: WorkflowNodeDefinition<NumberNode> = {
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

const BOOLEAN_NODE_DEFINITION: WorkflowNodeDefinition<BooleanNode> = {
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

const TEMPLATE_NODE_DEFINITION: WorkflowNodeDefinition<TemplateNode> = {
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

const GET_TOGGLE_NODE_DEFINITION: WorkflowNodeDefinition<GetToggleNode> = {
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

const GET_CHAT_VAR_NODE_DEFINITION: WorkflowNodeDefinition<GetChatVarNode> = {
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

const SET_CHAT_VAR_NODE_DEFINITION: WorkflowNodeDefinition<SetChatVarNode> = {
    class: 'SetChatVar',
    label: 'Set Chat Var',
    category: 'variable',
    isSink: true,
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

const TO_BOOLEAN_NODE_DEFINITION: WorkflowNodeDefinition<ToBooleanNode> = {
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

const TO_NUMBER_NODE_DEFINITION: WorkflowNodeDefinition<ToNumberNode> = {
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

const CATCH_NODE_DEFINITION: WorkflowNodeDefinition<CatchNode> = {
    class: 'Catch',
    label: 'Catch',
    category: 'flow',
    inputs: {
        value: { name: 'Value', type: 'string', required: true },
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
        inputs: { value: null, fallback: null },
        inputValues: { value: '', fallback: '' }
    })
};

const THROWIF_NODE_DEFINITION: WorkflowNodeDefinition<ThrowIfNode> = {
    class: 'ThrowIf',
    label: 'Throw If',
    category: 'flow',
    inputs: {
        condition: { name: 'Condition', type: 'boolean', required: true },
        value: { name: 'Value', type: 'string', required: true }
    },
    outputs: { 0: { name: 'value', type: 'string' } },
    createDefault: (id) => ({
        id,
        name: 'Throw If',
        class: 'ThrowIf',
        position: { x: 0, y: 0 },
        inputs: { condition: null, value: null },
        inputValues: { condition: false, value: '' }
    })
};

const CONCAT_NODE_DEFINITION: WorkflowNodeDefinition<StringConcatNode> = {
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

const STRING_LENGTH_NODE_DEFINITION: WorkflowNodeDefinition<StringLengthNode> = {
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

const STRING_INCLUDES_NODE_DEFINITION: WorkflowNodeDefinition<StringIncludesNode> = {
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

const STRING_REPLACE_NODE_DEFINITION: WorkflowNodeDefinition<StringReplaceNode> = {
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

const STRING_REGEX_REPLACE_NODE_DEFINITION: WorkflowNodeDefinition<StringRegexReplaceNode> = {
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

const FILTER_AGENT_PARTS_NODE_DEFINITION: WorkflowNodeDefinition<FilterAgentPartsNode> = {
    class: 'FilterAgentParts',
    label: 'Filter Agent Parts',
    category: 'agent',
    inputs: {
        content: { name: 'Content', type: 'string', required: false },
        stream: STREAM_INPUT
    },
    outputs: RESULT_STRING_OUTPUT,
    createDefault: (id) => ({
        id,
        name: 'Filter Agent Parts',
        class: 'FilterAgentParts',
        position: { x: 0, y: 0 },
        includeText: true,
        includeThought: true,
        includeInlay: true,
        includeToolCalls: true,
        inputs: { content: null, stream: null },
        inputValues: { content: '', stream: false }
    })
};

const SELECT_VISIBLE_PARTS_NODE_DEFINITION: WorkflowNodeDefinition<SelectVisiblePartsNode> = {
    class: 'SelectVisibleParts',
    label: 'Select Visible Parts',
    category: 'agent',
    inputs: {
        content: { name: 'Content', type: 'string', required: false },
        stream: STREAM_INPUT
    },
    outputs: RESULT_STRING_OUTPUT,
    createDefault: (id) => ({
        id,
        name: 'Select Visible Parts',
        class: 'SelectVisibleParts',
        position: { x: 0, y: 0 },
        inputs: { content: null, stream: null },
        inputValues: { content: '', stream: false }
    })
};

const SELECT_LAST_TEXT_PART_NODE_DEFINITION: WorkflowNodeDefinition<SelectLastTextPartNode> = {
    class: 'SelectLastTextPart',
    label: 'Select Last Text Part',
    category: 'agent',
    inputs: {
        content: { name: 'Content', type: 'string', required: false },
        stream: STREAM_INPUT
    },
    outputs: RESULT_STRING_OUTPUT,
    createDefault: (id) => ({
        id,
        name: 'Select Last Text Part',
        class: 'SelectLastTextPart',
        position: { x: 0, y: 0 },
        inputs: { content: null, stream: null },
        inputValues: { content: '', stream: false }
    })
};

const IMAGE_GENERATION_NODE_DEFINITION: WorkflowNodeDefinition<ImageGenerationNode> = {
    class: 'ImageGeneration',
    label: 'Image Generation',
    category: 'agent',
    inputs: {
        prompt: { name: 'Prompt', type: 'string', required: true },
        negativePrompt: { name: 'Negative Prompt', type: 'string', required: false },
        referenceImages: {
            name: 'Reference Images',
            type: 'string',
            required: false,
            allowLiteral: false
        },
        styleImages: {
            name: 'Style Images',
            type: 'string',
            required: false,
            allowLiteral: false
        }
    },
    outputs: { 0: { name: 'image', type: 'string' } },
    createDefault: (id) => ({
        id,
        name: 'Image Generation',
        class: 'ImageGeneration',
        position: { x: 0, y: 0 },
        inputs: {
            prompt: null,
            negativePrompt: null,
            referenceImages: null,
            styleImages: null
        },
        inputValues: {
            prompt: '',
            negativePrompt: ''
        }
    })
};

const TTS_NODE_DEFINITION: WorkflowNodeDefinition<TTSNode> = {
    class: 'TTS',
    label: 'Text to Speech',
    category: 'agent',
    inputs: {
        text: { name: 'Text', type: 'string', required: true }
    },
    outputs: { 0: { name: 'audio', type: 'string' } },
    createDefault: (id) => ({
        id,
        name: 'Text to Speech',
        class: 'TTS',
        position: { x: 0, y: 0 },
        inputs: { text: null },
        inputValues: { text: '' }
    })
};

const STT_NODE_DEFINITION: WorkflowNodeDefinition<STTNode> = {
    class: 'STT',
    label: 'Speech to Text',
    category: 'agent',
    inputs: {
        audio: { name: 'Audio', type: 'string', required: true, allowLiteral: false }
    },
    outputs: { 0: { name: 'text', type: 'string' } },
    createDefault: (id) => ({
        id,
        name: 'Speech to Text',
        class: 'STT',
        position: { x: 0, y: 0 },
        inputs: { audio: null },
        inputValues: {}
    })
};

const GET_HISTORY_NODE_DEFINITION: WorkflowNodeDefinition<GetHistoryNode> = {
    class: 'GetHistory',
    label: 'Get History',
    category: 'history',
    inputs: {
        index: { name: 'Index', type: 'number', required: true }
    },
    outputs: STRING_OUTPUT,
    createDefault: (id) => ({
        id,
        name: 'Get History',
        class: 'GetHistory',
        position: { x: 0, y: 0 },
        inputs: { index: null },
        inputValues: { index: -1 }
    })
};

const SET_HISTORY_NODE_DEFINITION: WorkflowNodeDefinition<SetHistoryNode> = {
    class: 'SetHistory',
    label: 'Set History',
    category: 'history',
    isSink: true,
    inputs: {
        index: { name: 'Index', type: 'number', required: true },
        content: { name: 'Content', type: 'string', required: true }
    },
    outputs: {},
    createDefault: (id) => ({
        id,
        name: 'Set History',
        class: 'SetHistory',
        position: { x: 0, y: 0 },
        inputs: { index: null, content: null },
        inputValues: { index: -1, content: '' }
    })
};

const GET_IMAGE_ATTACHMENTS_NODE_DEFINITION: WorkflowNodeDefinition<GetImageAttachmentsNode> = {
    class: 'GetImageAttachments',
    label: 'Get Image Attachments',
    category: 'history',
    inputs: {
        index: { name: 'Index', type: 'number', required: true }
    },
    outputs: STRING_OUTPUT,
    createDefault: (id) => ({
        id,
        name: 'Get Image Attachments',
        class: 'GetImageAttachments',
        position: { x: 0, y: 0 },
        inputs: { index: null },
        inputValues: { index: -1 }
    })
};

const SET_IMAGE_ATTACHMENTS_NODE_DEFINITION: WorkflowNodeDefinition<SetImageAttachmentsNode> = {
    class: 'SetImageAttachments',
    label: 'Set Image Attachments',
    category: 'history',
    isSink: true,
    inputs: {
        index: { name: 'Index', type: 'number', required: true },
        content: {
            name: 'Content',
            type: 'string',
            required: true,
            allowLiteral: false
        }
    },
    outputs: {},
    createDefault: (id) => ({
        id,
        name: 'Set Image Attachments',
        class: 'SetImageAttachments',
        position: { x: 0, y: 0 },
        inputs: { index: null, content: null },
        inputValues: { index: -1 }
    })
};

const GET_AUDIO_ATTACHMENTS_NODE_DEFINITION: WorkflowNodeDefinition<GetAudioAttachmentsNode> = {
    class: 'GetAudioAttachments',
    label: 'Get Audio Attachments',
    category: 'history',
    inputs: {
        index: { name: 'Index', type: 'number', required: true }
    },
    outputs: STRING_OUTPUT,
    createDefault: (id) => ({
        id,
        name: 'Get Audio Attachments',
        class: 'GetAudioAttachments',
        position: { x: 0, y: 0 },
        inputs: { index: null },
        inputValues: { index: -1 }
    })
};

const SET_AUDIO_ATTACHMENTS_NODE_DEFINITION: WorkflowNodeDefinition<SetAudioAttachmentsNode> = {
    class: 'SetAudioAttachments',
    label: 'Set Audio Attachments',
    category: 'history',
    isSink: true,
    inputs: {
        index: { name: 'Index', type: 'number', required: true },
        content: {
            name: 'Content',
            type: 'string',
            required: true,
            allowLiteral: false
        }
    },
    outputs: {},
    createDefault: (id) => ({
        id,
        name: 'Set Audio Attachments',
        class: 'SetAudioAttachments',
        position: { x: 0, y: 0 },
        inputs: { index: null, content: null },
        inputValues: { index: -1 }
    })
};

const GET_TRANSLATION_NODE_DEFINITION: WorkflowNodeDefinition<GetTranslationNode> = {
    class: 'GetTranslation',
    label: 'Get Translation',
    category: 'history',
    inputs: {
        index: { name: 'Index', type: 'number', required: true }
    },
    outputs: STRING_OUTPUT,
    createDefault: (id) => ({
        id,
        name: 'Get Translation',
        class: 'GetTranslation',
        position: { x: 0, y: 0 },
        inputs: { index: null },
        inputValues: { index: -1 }
    })
};

const SET_TRANSLATION_NODE_DEFINITION: WorkflowNodeDefinition<SetTranslationNode> = {
    class: 'SetTranslation',
    label: 'Set Translation',
    category: 'history',
    isSink: true,
    inputs: {
        index: { name: 'Index', type: 'number', required: true },
        content: { name: 'Content', type: 'string', required: true }
    },
    outputs: {},
    createDefault: (id) => ({
        id,
        name: 'Set Translation',
        class: 'SetTranslation',
        position: { x: 0, y: 0 },
        inputs: { index: null, content: null },
        inputValues: { index: -1, content: '' }
    })
};

const NUMBER_MATH_NODE_DEFINITION: WorkflowNodeDefinition<NumberMathNode> = {
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

const NUMBER_COMPARE_NODE_DEFINITION: WorkflowNodeDefinition<NumberCompareNode> = {
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

const BOOLEAN_LOGIC_NODE_DEFINITION: WorkflowNodeDefinition<BooleanLogicNode> = {
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

const BOOLEAN_NOT_NODE_DEFINITION: WorkflowNodeDefinition<BooleanNotNode> = {
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

const GATE_NODE_DEFINITION: WorkflowNodeDefinition<GateNode> = {
    class: 'Gate',
    label: 'Gate',
    category: 'flow',
    inputs: {
        condition: { name: 'Condition', type: 'boolean', required: false },
        value: { name: 'Value', type: 'string', required: true }
    },
    outputs: { 0: { name: 'value', type: 'string' } },
    createDefault: (id) => ({
        id,
        name: 'Gate',
        class: 'Gate',
        position: { x: 0, y: 0 },
        inputs: { condition: null, value: null },
        inputValues: { condition: false, value: '' }
    })
};

const UNGATE_NODE_DEFINITION: WorkflowNodeDefinition<UngateNode> = {
    class: 'Ungate',
    label: 'Ungate',
    category: 'flow',
    inputs: {
        value: { name: 'Value', type: 'string', required: true },
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
        inputs: { value: null, fallback: null },
        inputValues: { value: '', fallback: '' }
    })
};

const OUTPUT_NODE_DEFINITION: WorkflowNodeDefinition<OutputNode> = {
    class: 'Output',
    label: 'Output',
    category: 'result',
    isSink: true,
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

const LOG_NODE_DEFINITION: WorkflowNodeDefinition<LogNode> = {
    class: 'Log',
    label: 'Log',
    category: 'result',
    isSink: true,
    inputs: { content: { name: 'Content', type: 'string', required: true } },
    outputs: {},
    createDefault: (id) => ({
        id,
        name: 'Log',
        class: 'Log',
        position: { x: 0, y: 0 },
        inputs: { content: null },
        inputValues: { content: '' }
    })
};

const SINK_NODE_DEFINITION: WorkflowNodeDefinition<SinkNode> = {
    class: 'Sink',
    label: 'Sink',
    category: 'result',
    isSink: true,
    inputs: { content: { name: 'Content', type: 'string', required: true } },
    outputs: {},
    createDefault: (id) => ({
        id,
        name: 'Sink',
        class: 'Sink',
        position: { x: 0, y: 0 },
        inputs: { content: null },
        inputValues: { content: '' }
    })
};

const FILE_READ_NODE_DEFINITION: WorkflowNodeDefinition<FileReadNode> = {
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

const FILE_WRITE_NODE_DEFINITION: WorkflowNodeDefinition<FileWriteNode> = {
    class: 'FileWrite',
    label: 'File Write',
    category: 'file',
    isSink: true,
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

const AGENT_NODE_DEFINITION: WorkflowNodeDefinition<AgentNode> = {
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
        toolIds: [],
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
    Agent: AGENT_NODE_DEFINITION,
    ImageGeneration: IMAGE_GENERATION_NODE_DEFINITION,
    TTS: TTS_NODE_DEFINITION,
    STT: STT_NODE_DEFINITION,
    FilterAgentParts: FILTER_AGENT_PARTS_NODE_DEFINITION,
    SelectVisibleParts: SELECT_VISIBLE_PARTS_NODE_DEFINITION,
    SelectLastTextPart: SELECT_LAST_TEXT_PART_NODE_DEFINITION,
    GetHistory: GET_HISTORY_NODE_DEFINITION,
    SetHistory: SET_HISTORY_NODE_DEFINITION,
    GetImageAttachments: GET_IMAGE_ATTACHMENTS_NODE_DEFINITION,
    SetImageAttachments: SET_IMAGE_ATTACHMENTS_NODE_DEFINITION,
    GetAudioAttachments: GET_AUDIO_ATTACHMENTS_NODE_DEFINITION,
    SetAudioAttachments: SET_AUDIO_ATTACHMENTS_NODE_DEFINITION,
    GetTranslation: GET_TRANSLATION_NODE_DEFINITION,
    SetTranslation: SET_TRANSLATION_NODE_DEFINITION,
    String: STRING_NODE_DEFINITION,
    Template: TEMPLATE_NODE_DEFINITION,
    Concat: CONCAT_NODE_DEFINITION,
    StringLength: STRING_LENGTH_NODE_DEFINITION,
    StringIncludes: STRING_INCLUDES_NODE_DEFINITION,
    StringReplace: STRING_REPLACE_NODE_DEFINITION,
    StringRegexReplace: STRING_REGEX_REPLACE_NODE_DEFINITION,
    Number: NUMBER_NODE_DEFINITION,
    ToNumber: TO_NUMBER_NODE_DEFINITION,
    NumberMath: NUMBER_MATH_NODE_DEFINITION,
    NumberCompare: NUMBER_COMPARE_NODE_DEFINITION,
    Boolean: BOOLEAN_NODE_DEFINITION,
    ToBoolean: TO_BOOLEAN_NODE_DEFINITION,
    BooleanLogic: BOOLEAN_LOGIC_NODE_DEFINITION,
    BooleanNot: BOOLEAN_NOT_NODE_DEFINITION,
    GetToggle: GET_TOGGLE_NODE_DEFINITION,
    GetChatVar: GET_CHAT_VAR_NODE_DEFINITION,
    SetChatVar: SET_CHAT_VAR_NODE_DEFINITION,
    ThrowIf: THROWIF_NODE_DEFINITION,
    Catch: CATCH_NODE_DEFINITION,
    Gate: GATE_NODE_DEFINITION,
    Ungate: UNGATE_NODE_DEFINITION,
    FileRead: FILE_READ_NODE_DEFINITION,
    FileWrite: FILE_WRITE_NODE_DEFINITION,
    Output: OUTPUT_NODE_DEFINITION,
    Log: LOG_NODE_DEFINITION,
    Sink: SINK_NODE_DEFINITION
} satisfies Record<WorkflowNodeClass, WorkflowNodeDefinition<WorkflowNode>>;

export function createDefaultWorkflowNode(nodeClass: WorkflowNodeClass, id: string): WorkflowNode {
    const node = WORKFLOW_NODE_DEFINITIONS[nodeClass].createDefault(id);
    return {
        ...node,
        collapsed: false
    } as WorkflowNode;
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

export function isSinkWorkflowNode(node: WorkflowNode): boolean {
    return WORKFLOW_NODE_DEFINITIONS[node.class].isSink === true;
}
