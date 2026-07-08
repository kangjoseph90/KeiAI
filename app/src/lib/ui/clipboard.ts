import { appClipboard } from '$lib/adapters/clipboard';
import { getErrorMessage } from '$lib/types/errors';
import { toast } from './toast';

export async function copyTextToClipboard(text: string, successTitle = 'Copied to clipboard') {
    try {
        await appClipboard.writeText(text);
        toast.success({ title: successTitle });
        return true;
    } catch (error) {
        toast.error({
            title: 'Copy failed',
            description: getErrorMessage(error, 'Could not copy text')
        });
        return false;
    }
}
