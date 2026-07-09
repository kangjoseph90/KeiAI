import { NotificationService } from '$lib/services/notification';
import { toast } from '$lib/ui/toast';

export function isDocumentVisible(): boolean {
    const doc = globalThis.document;
    if (!doc) return true;

    return doc.visibilityState !== 'hidden' && doc.hasFocus();
}

export async function showTaskNotificationOrToast(
    toastKind: 'success' | 'error',
    title: string,
    description: string
): Promise<void> {
    if (!isDocumentVisible()) {
        const shown = await NotificationService.show({
            title,
            body: description
        });
        if (shown) return;
    }

    toast[toastKind]({ title, description });
}
