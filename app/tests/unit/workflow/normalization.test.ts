import { describe, expect, it } from 'vitest';
import { normalizeWorkflow } from '$lib/workflow/normalization';
import type { WorkflowDefinition } from '$lib/workflow/types';

describe('normalizeWorkflow', () => {
    it('hydrates node defaults and nested prompt block defaults without mutating stored data', () => {
        const stored = {
            nodes: {
                agent: {
                    id: 'stale-id',
                    name: 'Legacy Agent',
                    class: 'Agent',
                    position: { x: 10, y: 20 },
                    llmType: 'chat',
                    promptBlocks: {
                        history: {
                            id: 'stale-block-id',
                            name: 'History',
                            type: 'history',
                            sortOrder: 'a',
                            enabled: true
                        }
                    },
                    inputs: { stream: null },
                    inputValues: { stream: true }
                }
            }
        };

        const normalized = normalizeWorkflow(stored as unknown as WorkflowDefinition);
        const agent = normalized.nodes.agent;

        expect(agent).toMatchObject({
            id: 'agent',
            class: 'Agent',
            name: 'Legacy Agent',
            toolIds: [],
            maxContext: 60000,
            maxResponse: 6000,
            slotNames: {}
        });
        expect(agent.class).toBe('Agent');
        if (agent.class !== 'Agent') throw new Error('Expected Agent node');
        expect(agent.promptBlocks.history).toEqual({
            id: 'history',
            name: 'History',
            type: 'history',
            historyMode: 'last_content',
            sortOrder: 'a',
            enabled: true
        });
        expect(
            (stored.nodes.agent.promptBlocks.history as { historyMode?: string }).historyMode
        ).toBeUndefined();
    });

    it('preserves dynamic Agent inputs and existing node-specific values', () => {
        const workflow: WorkflowDefinition = {
            nodes: {
                agent: {
                    id: 'agent',
                    name: 'Agent',
                    class: 'Agent',
                    position: { x: 0, y: 0 },
                    llmType: 'aux',
                    toolIds: ['file_read'],
                    promptBlocks: {},
                    maxContext: 12000,
                    maxResponse: 2000,
                    lorebookRatio: 0.3,
                    memoryRatio: 0.1,
                    lorebookScanDepth: 3,
                    slotNames: { custom: 'source' },
                    inputs: { stream: null, custom: null },
                    inputValues: { stream: false, custom: 'value' }
                }
            }
        };

        expect(normalizeWorkflow(workflow).nodes.agent).toEqual(workflow.nodes.agent);
    });
});
