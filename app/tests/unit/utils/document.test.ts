import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import {
    DOCX_MIME,
    extractDocumentText,
    isOfficeDocument,
    PPTX_MIME,
    XLSX_MIME
} from '$lib/utils/document';

describe('document text extraction', () => {
    it('identifies office documents by mime or filename extension', () => {
        expect(isOfficeDocument(DOCX_MIME)).toBe(true);
        expect(isOfficeDocument(PPTX_MIME)).toBe(true);
        expect(isOfficeDocument(XLSX_MIME)).toBe(true);
        expect(isOfficeDocument('application/octet-stream', 'test.docx')).toBe(true);
        expect(isOfficeDocument('application/octet-stream', 'test.pptx')).toBe(true);
        expect(isOfficeDocument('application/octet-stream', 'test.xlsx')).toBe(true);
        expect(isOfficeDocument('image/png', 'test.png')).toBe(false);
    });

    it('extracts text from DOCX documents with entity decoding', () => {
        const bytes = zipSync({
            'word/document.xml': strToU8(
                '<w:document><w:body><w:p><w:r><w:t>Paragraph 1: Apple &amp; Banana</w:t></w:r></w:p><w:p><w:r><w:t>Paragraph 2: &quot;Quotes&quot;</w:t></w:r></w:p></w:body></w:document>'
            )
        });

        const result = extractDocumentText(bytes, DOCX_MIME);
        expect(result).toBe('Paragraph 1: Apple & Banana\nParagraph 2: "Quotes"');
    });

    it('extracts slide texts from PPTX documents sorted in order', () => {
        const bytes = zipSync({
            'ppt/slides/slide2.xml': strToU8(
                '<p:sld><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Second slide content</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>'
            ),
            'ppt/slides/slide1.xml': strToU8(
                '<p:sld><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>First slide title</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>'
            )
        });

        const result = extractDocumentText(bytes, PPTX_MIME);
        expect(result).toBe('[Slide 1]\nFirst slide title\n\n[Slide 2]\nSecond slide content');
    });

    it('extracts sheet rows and shared strings from XLSX workbooks', () => {
        const bytes = zipSync({
            'xl/sharedStrings.xml': strToU8(
                '<sst><si><t>Header 1</t></si><si><t>Header 2</t></si><si><t>Item A</t></si></sst>'
            ),
            'xl/worksheets/sheet1.xml': strToU8(
                '<worksheet><sheetData>' +
                    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
                    '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>100</v></c></row>' +
                    '</sheetData></worksheet>'
            )
        });

        const result = extractDocumentText(bytes, XLSX_MIME);
        expect(result).toBe('[Sheet 1]\nHeader 1\tHeader 2\nItem A\t100');
    });

    it('returns null for non-office or invalid archives', () => {
        expect(extractDocumentText(new Uint8Array([1, 2, 3]), 'image/png')).toBeNull();
        expect(extractDocumentText(new Uint8Array([1, 2, 3]), DOCX_MIME)).toBeNull();
    });
});
