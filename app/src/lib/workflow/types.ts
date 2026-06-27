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
    | OutputNode
    | StringConcatNode
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

export interface WorkflowNodeStreamState {
    content: string;
}

export type WorkflowNodeStream = AsyncIterable<WorkflowNodeStreamState>;

export interface WorkflowInputStream {
    stream(): WorkflowNodeStream;
    final(): Promise<string>;
}

export interface WorkflowNodeExecutionContext<TNode extends WorkflowNode = WorkflowNode> {
    node: TNode;
    inputs: Record<string, WorkflowInputStream>;
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

export interface StringNode extends BaseNode {
    class: 'String';
    content: string;
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
    inputValues: Record<string, string>;
}
