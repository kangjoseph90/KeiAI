import { describe, expect, it, vi } from 'vitest';
import { buildPrompt } from '$lib/llm/prompt/builder';
import type { PagedMessages } from '$lib/services/content/paged_messages';
import type { Character, Lorebook, Message, Preset } from '$lib/services';

function makeMessage(id: string, role: Message['role'], content: string): Message {
    const swipeId = `${id}-swipe`;
    return {
        id,
        chatId: 'chat-1',
        sortOrder: id,
        role,
        activeSwipeId: swipeId,
        swipes: {
            [swipeId]: {
                id: swipeId,
                content,
                createdAt: 1
            }
        }
    };
}

describe('buildPrompt', () => {
    it('loads history from PagedMessages only when processing history entries', async () => {
        const slice = vi
            .fn<PagedMessages['slice']>()
            .mockResolvedValue([
                makeMessage('msg-1', 'user', 'hello'),
                makeMessage('msg-2', 'char', 'hi')
            ]);
        const messages = { slice } as unknown as PagedMessages;
        const preset = {
            templateOrder: [
                { name: 'System', type: 'instruction', role: 'system', content: 'rules' },
                { name: 'History', type: 'history', start: -10, end: -1 }
            ]
        } as Preset;

        const prompt = await buildPrompt({
            character: { systemPrompt: '' } as Character,
            preset,
            persona: null,
            lorebooks: [],
            messages
        });

        expect(slice).toHaveBeenCalledWith(-10, -1);
        expect(prompt).toEqual([
            { role: 'system', content: 'rules' },
            { role: 'user', content: 'hello', thought: undefined },
            { role: 'assistant', content: 'hi', thought: undefined }
        ]);
    });

    it('defaults history end to the end of the completed history view', async () => {
        const slice = vi.fn<PagedMessages['slice']>().mockResolvedValue([]);
        const messages = { slice } as unknown as PagedMessages;
        const preset = {
            templateOrder: [{ name: 'History', type: 'history', start: -10 }]
        } as Preset;

        await buildPrompt({
            character: { systemPrompt: '' } as Character,
            preset,
            persona: null,
            lorebooks: [],
            messages
        });

        expect(slice).toHaveBeenCalledWith(-10, undefined);
    });

    it('does not touch PagedMessages when the template has no history entries', async () => {
        const slice = vi.fn<PagedMessages['slice']>().mockResolvedValue([]);
        const messages = { slice } as unknown as PagedMessages;
        const lorebook = { enabled: true, content: 'lore' } as Lorebook;
        const preset = {
            templateOrder: [
                { name: 'Description', type: 'description' },
                { name: 'Lorebook', type: 'lorebook' }
            ]
        } as Preset;

        const prompt = await buildPrompt({
            character: { systemPrompt: 'character' } as Character,
            preset,
            persona: null,
            lorebooks: [lorebook],
            messages
        });

        expect(slice).not.toHaveBeenCalled();
        expect(prompt).toEqual([
            { role: 'system', content: 'character' },
            { role: 'system', content: 'lore' }
        ]);
    });
});
