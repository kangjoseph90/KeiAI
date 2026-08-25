import { strFromU8, unzipSync } from 'fflate';

const MAX_OFFICE_XML_BYTES = 5 * 1024 * 1024;

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const PPTX_MIME =
    'application/vnd.openxmlformats-officedocument.presentationml.presentation';
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function isOfficeDocument(mimeType: string, fileName?: string): boolean {
    const normalized = mimeType.trim().toLowerCase().split(';', 1)[0];
    if (normalized === DOCX_MIME || normalized === PPTX_MIME || normalized === XLSX_MIME) {
        return true;
    }
    const ext = fileName?.split('.').pop()?.toLowerCase();
    return ext === 'docx' || ext === 'pptx' || ext === 'xlsx';
}

export function resolveOfficeMimeType(mimeType: string, fileName?: string): string {
    const normalized = mimeType.trim().toLowerCase().split(';', 1)[0];
    if (normalized === DOCX_MIME || normalized === PPTX_MIME || normalized === XLSX_MIME) {
        return normalized;
    }
    const ext = fileName?.split('.').pop()?.toLowerCase();
    if (ext === 'docx') return DOCX_MIME;
    if (ext === 'pptx') return PPTX_MIME;
    if (ext === 'xlsx') return XLSX_MIME;
    return normalized;
}

export function extractDocumentText(
    bytes: Uint8Array,
    mimeType: string,
    fileName?: string
): string | null {
    const resolvedMime = resolveOfficeMimeType(mimeType, fileName);
    if (resolvedMime !== DOCX_MIME && resolvedMime !== PPTX_MIME && resolvedMime !== XLSX_MIME) {
        return null;
    }

    try {
        let selectedBytes = 0;
        const archive = unzipSync(bytes, {
            filter: (entry) => {
                if (!isRelevantOfficeEntry(entry.name, resolvedMime)) return false;
                if (entry.originalSize > MAX_OFFICE_XML_BYTES) return false;
                if (selectedBytes + entry.originalSize > MAX_OFFICE_XML_BYTES) return false;
                selectedBytes += entry.originalSize;
                return true;
            }
        });

        if (resolvedMime === DOCX_MIME) {
            const docEntry = archive['word/document.xml'];
            if (!docEntry) return null;
            return xmlToText(strFromU8(docEntry));
        }

        if (resolvedMime === PPTX_MIME) {
            const slideEntries = Object.entries(archive)
                .filter(([path]) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
                .sort(([a], [b]) => naturalCompare(a, b));

            return slideEntries
                .map(([path, data]) => {
                    const text = xmlToText(strFromU8(data));
                    const match = path.match(/slide(\d+)\.xml$/);
                    const label = match ? `[Slide ${match[1]}]` : '[Slide]';
                    return `${label}\n${text}`;
                })
                .filter((section) => section.trim().length > 0)
                .join('\n\n');
        }

        if (resolvedMime === XLSX_MIME) {
            const sharedStrings = parseXlsxSharedStrings(archive['xl/sharedStrings.xml']);
            const sheetEntries = Object.entries(archive)
                .filter(([path]) => /^xl\/worksheets\/sheet\d+\.xml$/.test(path))
                .sort(([a], [b]) => naturalCompare(a, b));

            return sheetEntries
                .map(([path, data]) => {
                    const text = parseXlsxSheet(strFromU8(data), sharedStrings);
                    const match = path.match(/sheet(\d+)\.xml$/);
                    const label = match ? `[Sheet ${match[1]}]` : '[Sheet]';
                    return `${label}\n${text}`;
                })
                .filter((section) => section.trim().length > 0)
                .join('\n\n');
        }
    } catch {
        return null;
    }

    return null;
}

function isRelevantOfficeEntry(path: string, mimeType: string): boolean {
    if (mimeType === DOCX_MIME) return path === 'word/document.xml';
    if (mimeType === PPTX_MIME) return /^ppt\/slides\/slide\d+\.xml$/.test(path);
    return path === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(path);
}

function naturalCompare(left: string, right: string): number {
    return left.localeCompare(right, undefined, { numeric: true });
}

function parseXlsxSharedStrings(data?: Uint8Array): string[] {
    if (!data) return [];
    const xml = strFromU8(data);
    const strings: string[] = [];
    const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
    let siMatch: RegExpExecArray | null;

    while ((siMatch = siRegex.exec(xml)) !== null) {
        const inner = siMatch[1];
        const tRegex = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
        let tMatch: RegExpExecArray | null;
        let entryText = '';
        while ((tMatch = tRegex.exec(inner)) !== null) {
            entryText += tMatch[1];
        }
        strings.push(decodeXmlEntities(entryText));
    }

    return strings;
}

function parseXlsxSheet(sheetXml: string, sharedStrings: string[]): string {
    const rows: string[] = [];
    const rowRegex = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
    let rowMatch: RegExpExecArray | null;

    while ((rowMatch = rowRegex.exec(sheetXml)) !== null) {
        const rowContent = rowMatch[1];
        const cellRegex = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
        let cellMatch: RegExpExecArray | null;
        const cellValues: string[] = [];

        while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
            const attributes = cellMatch[1];
            const cellInner = cellMatch[2];
            const isShared = /\bt="s"/.test(attributes);
            const isInline = /\bt="inlineStr"/.test(attributes);

            if (isShared) {
                const vMatch = cellInner.match(/<v>(\d+)<\/v>/);
                if (vMatch) {
                    const idx = Number.parseInt(vMatch[1], 10);
                    cellValues.push(sharedStrings[idx] ?? '');
                } else {
                    cellValues.push('');
                }
            } else if (isInline) {
                const tMatch = cellInner.match(/<t\b[^>]*>([\s\S]*?)<\/t>/);
                cellValues.push(tMatch ? decodeXmlEntities(tMatch[1]) : '');
            } else {
                const vMatch = cellInner.match(/<v>([\s\S]*?)<\/v>/);
                cellValues.push(vMatch ? decodeXmlEntities(vMatch[1]) : '');
            }
        }

        const rowText = cellValues.join('\t').trimEnd();
        if (rowText.length > 0) {
            rows.push(rowText);
        }
    }

    if (rows.length === 0) {
        return xmlToText(sheetXml);
    }

    return rows.join('\n');
}

export function xmlToText(xml: string): string {
    return decodeXmlEntities(
        xml
            .replace(/<w:tab\/?\s*>/g, '\t')
            .replace(/<w:(?:br|cr)\/?\s*>/g, '\n')
            .replace(/<a:br\/?\s*>/g, '\n')
            .replace(/<\/(?:w:p|a:p|row)>/g, '\n')
            .replace(/<\/(?:w:tc|c)>/g, '\t')
            .replace(/<[^>]+>/g, '')
    )
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

export function decodeXmlEntities(value: string): string {
    return value.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (entity, code: string) => {
        if (code === 'amp') return '&';
        if (code === 'lt') return '<';
        if (code === 'gt') return '>';
        if (code === 'quot') return '"';
        if (code === 'apos') return "'";
        const radix = code[1]?.toLowerCase() === 'x' ? 16 : 10;
        const digits = radix === 16 ? code.slice(2) : code.slice(1);
        const point = Number.parseInt(digits, radix);
        return Number.isFinite(point) ? String.fromCodePoint(point) : entity;
    });
}
