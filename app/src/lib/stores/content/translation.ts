import { get } from 'svelte/store';
import { TranslationService, type Translation, type TranslationFields } from '$lib/services';
import { activeChatId, messages, translations } from '../state';
import type { DeepPartial } from '$lib/utils/defaults';

// ─── Getter ─────────────────────────────────────────────────────────

export async function getTranslation(translationId: string): Promise<Translation | null> {
    const cached = translations.get(translationId);
    if (cached) return cached;

    const fetched = await TranslationService.get(translationId);
    if (fetched && shouldSyncTranslation(fetched)) {
        translations.set(fetched.id, fetched);
    }
    return fetched;
}

// ─── Load ───────────────────────────────────────────────────────────

export async function loadTranslationsForMessages(
    chatId: string,
    messageIds: string[]
): Promise<void> {
    if (messageIds.length === 0) {
        if (get(activeChatId) === chatId) {
            translations.setAll([]);
        }
        return;
    }

    const loaded = await TranslationService.listByMessages(messageIds);
    if (get(activeChatId) === chatId) {
        translations.setAll(loaded);
    }
}

export async function addTranslationsForMessages(
    chatId: string,
    messageIds: string[]
): Promise<void> {
    if (messageIds.length === 0) return;

    const loaded = await TranslationService.listByMessages(messageIds);
    if (loaded.length === 0) return;
    if (get(activeChatId) !== chatId) return;

    translations.batch(() => {
        for (const translation of loaded) {
            translations.set(translation.id, translation);
        }
    });
}

export function dropTranslationsForMessages(messageIds: string[]): void {
    if (messageIds.length === 0) return;

    const messageIdSet = new Set(messageIds);
    const loaded = get(translations);
    translations.batch(() => {
        for (const translation of loaded) {
            if (messageIdSet.has(translation.messageId)) {
                translations.delete(translation.id);
            }
        }
    });
}

// ─── CRUD ───────────────────────────────────────────────────────────

export async function createTranslation(
    chatId: string,
    messageId: string,
    fields: TranslationFields
): Promise<Translation> {
    const scopeType = messages.get(messageId)?.scopeType ?? 'user';
    const created = await TranslationService.create(chatId, messageId, fields, scopeType);

    if (shouldSyncTranslation(created)) {
        translations.set(created.id, created);
    }

    return created;
}

export async function updateTranslation(
    translationId: string,
    changes: DeepPartial<TranslationFields>
): Promise<void> {
    const updated = await TranslationService.update(translationId, changes);

    if (shouldSyncTranslation(updated)) {
        translations.set(updated.id, updated);
    } else {
        translations.delete(updated.id);
    }
}

export async function deleteTranslation(translationId: string): Promise<void> {
    await TranslationService.delete(translationId);
    translations.delete(translationId);
}

// ─── Internal Helpers ───────────────────────────────────────────────

function shouldSyncTranslation(translation: Translation): boolean {
    return get(activeChatId) === translation.chatId && messages.has(translation.messageId);
}
