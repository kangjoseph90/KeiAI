import { describe, expect, it } from 'vitest';
import { readRisuPresetJson } from '$lib/porters/preset/risu';
import type { AgentNode, MemoryPromptBlock } from '$lib/workflow/types';

describe('Risu preset porter', () => {
    it('imports memory prompt items as KeiAI memory blocks', () => {
        const pkg = readRisuPresetJson({
            name: 'Risu Memory',
            promptTemplate: [
                {
                    type: 'memory',
                    name: 'Past conversation',
                    innerFormat: '<memory>\n{{slot}}\n{{user}}\n</memory>'
                }
            ]
        });
        const agent = pkg.preset.chatWorkflow.nodes.chat_agent as AgentNode;
        const block = Object.values(agent.promptBlocks)[0] as MemoryPromptBlock;

        expect(block).toEqual({
            id: 'block_0',
            sortOrder: expect.any(String),
            enabled: true,
            name: 'Past conversation',
            type: 'memory',
            algorithmId: 'mock',
            importance: 1,
            role: 'system',
            format: '<memory>\n{{slot}}\n{{user}}\n</memory>'
        });
        expect(block).not.toHaveProperty('start');
        expect(block).not.toHaveProperty('end');
    });
});
