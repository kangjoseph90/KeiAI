import { NotificationService } from '$lib/services/notification';

export function isDocumentVisible(): boolean {
    const doc = globalThis.document;
    if (!doc) return true;

    return doc.visibilityState !== 'hidden' && doc.hasFocus();
}

export async function showTaskSystemNotification(
    title: string,
    description: string
): Promise<void> {
    if (isDocumentVisible()) return;
    await NotificationService.show({
        title,
        body: description
    });
}
