import type { LLMRole, LLMType } from '$lib/types/models/llm';
import type { Macro } from '$lib/template';
import type { RuntimeContext } from '$lib/types/context';
import type { PagedMessages } from '$lib/services/content/paged_messages';
import type { DeepPartial } from '$lib/utils/defaults';

export type PromptBlockFields =
    | { name: string; type: 'text'; role: LLMRole; content: string }
    | {
          name: string;
          type: 'lorebook';
          minDepth?: number;
          maxDepth?: number;
          reverseOrder?: boolean;
          format?: string;
      }
    | { name: string; type: 'history'; start?: number; end?: number; format?: string };

export type PromptBlock = PromptBlockFields & {
    id: string;
    sortOrder: string;
    enabled: boolean;
};

export type WorkflowNode =
    | FileReadNode
    | FileWriteNode
    | BooleanNode
    | BooleanLogicNode
    | BooleanNotNode
    | GateNode
    | UngateNode
    | NumberNode
    | NumberCompareNode
    | NumberMathNode
    | OutputNode
    | StringConcatNode
    | StringIncludesNode
    | StringLengthNode
    | StringNode
    | AgentNode;

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
    emit(event: WorkflowNodeEvent): void;
}

export interface WorkflowNodeExecutionContext<TNode extends WorkflowNode = WorkflowNode> {
    node: TNode;
    inputs: Record<string, WorkflowInput>;
    output: WorkflowOutput;
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
    inputs: Record<string, InputPort>;
    inputValues: Record<string, WorkflowValue>;
}
