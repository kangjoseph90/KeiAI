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
    const startedHidden = !isDocumentVisible();
    if (startedHidden) {
        const shown = await NotificationService.show({
            title,
            body: description
        });
        if (shown) return;
    }

    const shouldPersist = startedHidden && !isDocumentVisible();
    toast[toastKind]({
        title,
        description,
        ...(shouldPersist ? { persistent: true } : {})
    });
}
