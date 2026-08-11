import type { WorkflowDefinition } from '$lib/workflow/types';
import type { EntityListConfig, OrderedRef } from './refs';

export interface ChatCommandFields {
    name: string;
    description: string;
    workflow: WorkflowDefinition;
}

export interface ChatCommand extends OrderedRef, ChatCommandFields {}

export type ChatCommandPanel = EntityListConfig<ChatCommand>;

export const defaultChatCommandFields: ChatCommandFields = {
    name: 'command',
    description: '',
    workflow: { nodes: {} }
};

export type ChatCommandOwner = { type: 'preset'; id: string } | { type: 'module'; id: string };

export interface ResolvedChatCommand {
    owner: ChatCommandOwner;
    ownerName: string;
    command: ChatCommand;
}
