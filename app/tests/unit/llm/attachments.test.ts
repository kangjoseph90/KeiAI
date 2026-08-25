import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import {
    fileBytesToLLMPart,
    MAX_ATTACHMENT_PROMPT_CHARS,
    officeFileToTextPart
} from '$lib/llm/attachments';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function docxBytes(text: string): Uint8Array {
    return zipSync({
        'word/document.xml': strToU8(
            `<w:document><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`
        )
    });
}

describe('attachment prompt conversion', () => {
    it('turns plain text into bounded prompt text', () => {
        const text = 'a'.repeat(MAX_ATTACHMENT_PROMPT_CHARS + 10);

        expect(
            fileBytesToLLMPart('notes.txt', 'text/plain', new TextEncoder().encode(text))
        ).toEqual({
            type: 'text',
            text:
                '<attachment file="notes.txt">\n' +
                `${'a'.repeat(MAX_ATTACHMENT_PROMPT_CHARS)}\n[Attachment text truncated]\n` +
                '</attachment>'
        });
    });

    it('keeps documents as provider-neutral native file parts', () => {
        expect(fileBytesToLLMPart('report.pdf', 'application/pdf', new Uint8Array([1]))).toEqual({
            type: 'file',
            name: 'report.pdf',
            mimeType: 'application/pdf',
            data: 'AQ=='
        });
    });

    it('extracts readable text from a DOCX fallback', () => {
        expect(
            officeFileToTextPart('report.docx', DOCX_MIME, docxBytes('Hello &amp; goodbye'))
        ).toEqual({
            type: 'text',
            text: '<attachment file="report.docx">\nHello & goodbye\n</attachment>'
        });
    });

    it('converts empty attachments into a marker instead of failing the prompt', () => {
        expect(
            fileBytesToLLMPart('empty.txt', 'text/plain', new TextEncoder().encode(' \u0000 '))
        ).toEqual({
            type: 'text',
            text: '<attachment file="empty.txt">\n[Attachment contains no readable text]\n</attachment>'
        });
    });

    it('marks unreadable Office attachments instead of throwing', () => {
        expect(
            officeFileToTextPart('broken.docx', DOCX_MIME, new Uint8Array([0, 1, 2, 3]))
        ).toEqual({
            type: 'text',
            text: '<attachment file="broken.docx">\n[Attachment contains no readable text]\n</attachment>'
        });
    });

    it('escapes file names inside the attachment framing', () => {
        expect(
            fileBytesToLLMPart('evil" name="x.txt', 'text/plain', new TextEncoder().encode('ok'))
        ).toEqual({
            type: 'text',
            text: '<attachment file="evil&quot; name=&quot;x.txt">\nok\n</attachment>'
        });
    });
});
