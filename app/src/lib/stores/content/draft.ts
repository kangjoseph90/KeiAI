import { get } from 'svelte/store';
import { createCache } from '$lib/adapters/cache';
import { chatDrafts } from '../state';
import type { ChatDraft } from '../types';

const draftCache = createCache<ChatDraft>('chat-drafts', 500);
const loadingDrafts = new Map<string, Promise<ChatDraft>>();
export const MAX_CHAT_DRAFT_INLAYS = 4;

function normalizeDraft(value: ChatDraft | undefined): ChatDraft {
    if (!value) return { text: '', inlayIds: [], suggestions: {} };
    const suggestions =
        value.suggestions && typeof value.suggestions === 'object'
            ? Object.fromEntries(
                  Object.entries(value.suggestions).filter(
                      ([id, text]) => typeof id === 'string' && typeof text === 'string'
                  )
              )
            : {};
    return {
        text: typeof value.text === 'string' ? value.text : '',
        inlayIds: Array.isArray(value.inlayIds)
            ? Array.from(new Set(value.inlayIds.filter((id) => typeof id === 'string')))
            : [],
        suggestions
    };
}

function saveDraft(chatId: string, draft: ChatDraft): void {
    const normalized = normalizeDraft(draft);
    chatDrafts.update((drafts) => {
        const next = new Map(drafts);
        next.set(chatId, normalized);
        return next;
    });
    draftCache.set(chatId, normalized);
}

export async function loadChatDraft(chatId: string): Promise<ChatDraft> {
    const current = get(chatDrafts).get(chatId);
    if (current) return current;

    const pending = loadingDrafts.get(chatId);
    if (pending) return pending;

    const load = (async () => {
        await draftCache.flush();
        const existing = get(chatDrafts).get(chatId);
        if (existing) return existing;

        const draft = normalizeDraft(draftCache.get(chatId));
        chatDrafts.update((drafts) => {
            if (drafts.has(chatId)) return drafts;
            const next = new Map(drafts);
            next.set(chatId, draft);
            return next;
        });
        return get(chatDrafts).get(chatId) ?? draft;
    })().finally(() => loadingDrafts.delete(chatId));

    loadingDrafts.set(chatId, load);
    return load;
}

export function getChatDraft(chatId: string): ChatDraft {
    return get(chatDrafts).get(chatId) ?? { text: '', inlayIds: [], suggestions: {} };
}

export function setChatDraftText(chatId: string, text: string): void {
    const current = getChatDraft(chatId);
    saveDraft(chatId, { ...current, text });
}

export function setChatDraftInlayIds(chatId: string, inlayIds: string[]): void {
    const current = getChatDraft(chatId);
    saveDraft(chatId, { ...current, inlayIds });
}

export function addChatDraftInlay(chatId: string, inlayId: string): boolean {
    const current = getChatDraft(chatId);
    if (current.inlayIds.includes(inlayId) || current.inlayIds.length >= MAX_CHAT_DRAFT_INLAYS) {
        return false;
    }
    setChatDraftInlayIds(chatId, [...current.inlayIds, inlayId]);
    return true;
}

export async function appendChatDraftText(chatId: string, text: string): Promise<void> {
    const transcript = text.trim();
    if (!transcript) return;

    const current = await loadChatDraft(chatId);
    const separator = current.text.length > 0 && !current.text.endsWith('\n') ? '\n' : '';
    saveDraft(chatId, { ...current, text: `${current.text}${separator}${transcript}` });
    await draftCache.flush();
}

export function clearChatDraft(chatId: string): void {
    chatDrafts.update((drafts) => {
        if (!drafts.has(chatId)) return drafts;
        const next = new Map(drafts);
        next.delete(chatId);
        return next;
    });
    draftCache.delete(chatId);
}

export function setChatDraftSuggestion(chatId: string, suggestionId: string, text: string): void {
    const current = getChatDraft(chatId);
    saveDraft(chatId, {
        ...current,
        suggestions: { ...current.suggestions, [suggestionId]: text }
    });
}

export function dismissChatDraftSuggestion(chatId: string, suggestionId: string): void {
    const current = getChatDraft(chatId);
    if (!(suggestionId in current.suggestions)) return;
    const next = { ...current.suggestions };
    delete next[suggestionId];
    saveDraft(chatId, { ...current, suggestions: next });
}

export function flushChatDrafts(): Promise<void> {
    return draftCache.flush();
}
