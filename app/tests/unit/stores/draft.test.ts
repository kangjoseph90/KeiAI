import { afterEach, describe, expect, it } from 'vitest';
import {
    appendChatDraftText,
    clearChatDraft,
    flushChatDrafts,
    getChatDraft,
    loadChatDraft,
    setChatDraftInlayIds,
    setChatDraftText
} from '$lib/stores/content/draft';
import { chatDrafts } from '$lib/stores/state';

const usedChatIds = new Set<string>();

function chatId(label: string): string {
    const id = `draft-test-${label}-${crypto.randomUUID()}`;
    usedChatIds.add(id);
    return id;
}

afterEach(async () => {
    for (const id of usedChatIds) clearChatDraft(id);
    usedChatIds.clear();
    await flushChatDrafts();
    chatDrafts.set(new Map());
});

describe('chat drafts', () => {
    it('stores text and inlay IDs independently for each chat', () => {
        const first = chatId('first');
        const second = chatId('second');

        setChatDraftText(first, 'hello');
        setChatDraftInlayIds(first, ['audio-1', 'image-1']);
        setChatDraftText(second, 'other');

        expect(getChatDraft(first)).toEqual({
            text: 'hello',
            inlayIds: ['audio-1', 'image-1']
        });
        expect(getChatDraft(second)).toEqual({ text: 'other', inlayIds: [] });
    });

    it('appends a transcript on a new line without changing attachments', async () => {
        const id = chatId('append');
        setChatDraftText(id, 'Existing draft');
        setChatDraftInlayIds(id, ['inlay-1']);

        await appendChatDraftText(id, '  spoken text  ');

        expect(getChatDraft(id)).toEqual({
            text: 'Existing draft\nspoken text',
            inlayIds: ['inlay-1']
        });
    });

    it('reloads a flushed draft from the local cache', async () => {
        const id = chatId('reload');
        setChatDraftText(id, 'persisted');
        setChatDraftInlayIds(id, ['inlay-1']);
        await flushChatDrafts();
        chatDrafts.set(new Map());

        await expect(loadChatDraft(id)).resolves.toEqual({
            text: 'persisted',
            inlayIds: ['inlay-1']
        });
    });
});
