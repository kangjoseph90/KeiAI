import type { LLMFilePart, LLMTextPart } from '$lib/llm/types';
import { isTextAsset } from '$lib/types/asset';
import { toBase64 } from '$lib/crypto';
import { extractDocumentText, isOfficeDocument } from '$lib/utils/document';
import { charsetFromMimeType, decodeTextBytes } from '$lib/utils/text';

export const MAX_ATTACHMENT_PROMPT_CHARS = 50_000;

const EMPTY_ATTACHMENT_PLACEHOLDER = '[Attachment contains no readable text]';

export function fileBytesToLLMPart(
    name: string,
    mimeType: string,
    bytes: Uint8Array
): LLMTextPart | LLMFilePart {
    const normalizedMimeType = mimeType.trim().toLowerCase().split(';', 1)[0];
    if (isTextAsset(name, normalizedMimeType)) {
        return textPart(
            name,
            decodeTextBytes(
                bytes.subarray(0, MAX_ATTACHMENT_PROMPT_CHARS * 4 + 1),
                charsetFromMimeType(mimeType)
            )
        );
    }

    return {
        type: 'file',
        name,
        mimeType: normalizedMimeType,
        data: toBase64(new Uint8Array(bytes))
    };
}

export function officeFileToTextPart(
    name: string,
    mimeType: string,
    bytes: Uint8Array
): LLMTextPart | null {
    if (!isOfficeDocument(mimeType, name)) {
        return null;
    }
    return textPart(name, extractDocumentText(bytes, mimeType, name) ?? '');
}

function textPart(name: string, text: string): LLMTextPart {
    const normalized = text.replaceAll('\u0000', '').trim();
    const truncated = normalized.length > MAX_ATTACHMENT_PROMPT_CHARS;
    const content = truncated
        ? normalized.slice(0, MAX_ATTACHMENT_PROMPT_CHARS)
        : normalized || EMPTY_ATTACHMENT_PLACEHOLDER;
    return {
        type: 'text',
        text:
            `<attachment file="${escapeAttachmentName(name)}">\n` +
            `${content}${truncated ? '\n[Attachment text truncated]' : ''}\n` +
            '</attachment>'
    };
}

function escapeAttachmentName(name: string): string {
    return name
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}
