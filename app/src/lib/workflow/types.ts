import type { LLMRole, LLMType } from '$lib/types/models/llm';
import type { Macro } from '$lib/template';
import type { RuntimeContext } from '$lib/types/context';
import type { PagedMessages } from '$lib/services/content/paged_messages';
import type { DeepPartial } from '$lib/utils/defaults';

export type MessagePromptBlockFields = {
    name: string;
    type: 'message';
    role: LLMRole;
    content: string;
};

export type LorebookPromptBlockFields = {
    name: string;
    type: 'lorebook';
    minDepth?: number;
    maxDepth?: number;
    reverseOrder?: boolean;
    format?: string;
};

export type HistoryPromptBlockFields = {
    name: string;
    type: 'history';
    start?: string;
    end?: string;
    format?: string;
    historyMode: 'last_text' | 'visible' | 'full_trace';
};

export type PromptBlockFields =
    | MessagePromptBlockFields
    | LorebookPromptBlockFields
    | HistoryPromptBlockFields;

type PromptBlockMetadata = {
    id: string;
    sortOrder: string;
    enabled: boolean;
};

export type MessagePromptBlock = MessagePromptBlockFields & PromptBlockMetadata;
export type LorebookPromptBlock = LorebookPromptBlockFields & PromptBlockMetadata;
export type HistoryPromptBlock = HistoryPromptBlockFields & PromptBlockMetadata;
export type PromptBlock = MessagePromptBlock | LorebookPromptBlock | HistoryPromptBlock;

export type WorkflowNode =
    | AgentNode
    | FilterAgentPartsNode
    | SelectVisiblePartsNode
    | SelectLastTextPartNode
    | ImageGenerationNode
    | TTSNode
    | STTNode
    | GetHistoryNode
    | SetHistoryNode
    | GetImageAttachmentsNode
    | SetImageAttachmentsNode
    | GetAudioAttachmentsNode
    | SetAudioAttachmentsNode
    | GetTranslationNode
    | SetTranslationNode
    | BooleanLogicNode
    | FileReadNode
    | FileWriteNode
    | TemplateNode
    | GetToggleNode
    | GetChatVarNode
    | SetChatVarNode
    | ToBooleanNode
    | ToNumberNode
    | CatchNode
    | ThrowIfNode
    | BooleanNode
    | BooleanNotNode
    | GateNode
    | UngateNode
    | NumberNode
    | NumberCompareNode
    | NumberMathNode
    | OutputNode
    | LogNode
    | SinkNode
    | StringConcatNode
    | StringIncludesNode
    | StringLengthNode
    | StringReplaceNode
    | StringRegexReplaceNode
    | StringNode;

export type WorkflowNodeClass = WorkflowNode['class'];

export interface WorkflowDefinition {
    nodes: Record<string, WorkflowNode>;
}

export type WorkflowPatch = DeepPartial<WorkflowDefinition>;

export interface WorkflowNodePosition {
    x: number;
    y: number;
}

export type WorkflowPortType = 'string' | 'number' | 'boolean';

export type WorkflowValue = string | number | boolean;

export interface WorkflowValueEvent {
    status: 'value';
    value: WorkflowValue;
}

export type WorkflowNodeEvent =
    | WorkflowValueEvent
    | {
          status: 'skip';
          message?: string;
      }
    | {
          status: 'error';
          error: unknown;
          message: string;
          nodeId?: string;
          nodeName?: string;
      };

/**
 * Upstream input port. `subscribe` for streaming/passthrough/recombinant nodes,
 * `done` for discrete nodes needing only the final value.
 */
export interface WorkflowInput {
    subscribe(onValue: (value: WorkflowValue) => void): void;
    done: Promise<WorkflowNodeEvent>;
}

/**
 * Output port. `emit` pushes any WorkflowNodeEvent.
 * Value events are streamed; skip/error events are terminal.
 * If the executor returns without emitting a terminal event, the runtime auto-completes.
 */
export interface WorkflowOutput {
    emit(port: number, event: WorkflowNodeEvent): void;
}

export interface WorkflowNodeExecutionContext<TNode extends WorkflowNode = WorkflowNode> {
    node: TNode;
    inputs: Record<string, WorkflowInput>;
    output: WorkflowOutput;
    emitRuntimeOutput(event: WorkflowNodeEvent): void;
    ctx?: RuntimeContext;
    localMacros?: ReadonlyMap<string, Macro>;
    messages?: PagedMessages;
    signal: AbortSignal;
}

export type FileNamespace = 'global' | 'room' | 'chat';

export interface FileReadNode extends BaseNode {
    class: 'FileRead';
    namespace: FileNamespace;
}

export interface FileWriteNode extends BaseNode {
    class: 'FileWrite';
    namespace: FileNamespace;
}

export interface OutputNode extends BaseNode {
    class: 'Output';
}

export interface LogNode extends BaseNode {
    class: 'Log';
}

export interface SinkNode extends BaseNode {
    class: 'Sink';
}

export interface TemplateNode extends BaseNode {
    class: 'Template';
}

export interface GetToggleNode extends BaseNode {
    class: 'GetToggle';
}

export interface GetChatVarNode extends BaseNode {
    class: 'GetChatVar';
}

export interface SetChatVarNode extends BaseNode {
    class: 'SetChatVar';
}

export interface ToBooleanNode extends BaseNode {
    class: 'ToBoolean';
}

export interface ToNumberNode extends BaseNode {
    class: 'ToNumber';
}

export interface CatchNode extends BaseNode {
    class: 'Catch';
}

export interface ThrowIfNode extends BaseNode {
    class: 'ThrowIf';
}

export interface StringConcatNode extends BaseNode {
    class: 'Concat';
}

export interface StringLengthNode extends BaseNode {
    class: 'StringLength';
}

export interface StringIncludesNode extends BaseNode {
    class: 'StringIncludes';
    caseSensitive: boolean;
}

export interface StringReplaceNode extends BaseNode {
    class: 'StringReplace';
}

export interface StringRegexReplaceNode extends BaseNode {
    class: 'StringRegexReplace';
    flags: string;
}

export interface FilterAgentPartsNode extends BaseNode {
    class: 'FilterAgentParts';
    includeText: boolean;
    includeThought: boolean;
    includeInlay: boolean;
    includeToolCalls: boolean;
}

export interface SelectVisiblePartsNode extends BaseNode {
    class: 'SelectVisibleParts';
}

export interface SelectLastTextPartNode extends BaseNode {
    class: 'SelectLastTextPart';
}

export interface ImageGenerationNode extends BaseNode {
    class: 'ImageGeneration';
}

export interface TTSNode extends BaseNode {
    class: 'TTS';
}

export interface STTNode extends BaseNode {
    class: 'STT';
}

export interface GetHistoryNode extends BaseNode {
    class: 'GetHistory';
}

export interface SetHistoryNode extends BaseNode {
    class: 'SetHistory';
}

export interface GetImageAttachmentsNode extends BaseNode {
    class: 'GetImageAttachments';
}

export interface SetImageAttachmentsNode extends BaseNode {
    class: 'SetImageAttachments';
}

export interface GetAudioAttachmentsNode extends BaseNode {
    class: 'GetAudioAttachments';
}

export interface SetAudioAttachmentsNode extends BaseNode {
    class: 'SetAudioAttachments';
}

export interface GetTranslationNode extends BaseNode {
    class: 'GetTranslation';
}

export interface SetTranslationNode extends BaseNode {
    class: 'SetTranslation';
}

export interface StringNode extends BaseNode {
    class: 'String';
    content: string;
}

export interface NumberNode extends BaseNode {
    class: 'Number';
    value: number;
}

export type NumberMathOperator = 'add' | 'subtract' | 'multiply' | 'divide';

export interface NumberMathNode extends BaseNode {
    class: 'NumberMath';
    operator: NumberMathOperator;
}

export type NumberCompareOperator =
    | 'equal'
    | 'notEqual'
    | 'greaterThan'
    | 'greaterThanOrEqual'
    | 'lessThan'
    | 'lessThanOrEqual';

export interface NumberCompareNode extends BaseNode {
    class: 'NumberCompare';
    operator: NumberCompareOperator;
}

export interface BooleanNode extends BaseNode {
    class: 'Boolean';
    value: boolean;
}

export type BooleanLogicOperator = 'and' | 'or' | 'xor' | 'nand' | 'nor' | 'xnor';

export interface BooleanLogicNode extends BaseNode {
    class: 'BooleanLogic';
    operator: BooleanLogicOperator;
}

export interface BooleanNotNode extends BaseNode {
    class: 'BooleanNot';
}

export interface GateNode extends BaseNode {
    class: 'Gate';
}

export interface UngateNode extends BaseNode {
    class: 'Ungate';
}

export interface AgentNode extends BaseNode {
    class: 'Agent';
    llmType: LLMType;
    toolIds: string[];
    promptBlocks: Record<string, PromptBlock>;
    maxContext: number;
    maxResponse: number;
    lorebookRatio: number;
    memoryRatio: number;
    lorebookScanDepth: number;
    slotNames: Record<string, string>;
}

export type InputPort = {
    sourceNode: string;
    sourcePort: number;
} | null;

export interface BaseNode {
    id: string;
    name: string;
    position: WorkflowNodePosition;
    collapsed: boolean;
    inputs: Record<string, InputPort>;
    inputValues: Record<string, WorkflowValue>;
}
