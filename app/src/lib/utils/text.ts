const UTF8_BOM = [0xef, 0xbb, 0xbf] as const;

export function decodeTextBytes(bytes: Uint8Array, declaredCharset?: string): string {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
        return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    }
    if (bytes[0] === 0xfe && bytes[1] === 0xff) {
        const swapped = new Uint8Array(Math.max(0, bytes.length - 2));
        for (let index = 2; index + 1 < bytes.length; index += 2) {
            swapped[index - 2] = bytes[index + 1];
            swapped[index - 1] = bytes[index];
        }
        return new TextDecoder('utf-16le').decode(swapped);
    }

    const content = startsWith(bytes, UTF8_BOM) ? bytes.subarray(UTF8_BOM.length) : bytes;
    const charset = normalizeCharset(declaredCharset);
    if (charset && charset !== 'utf-8') {
        try {
            return new TextDecoder(charset, { fatal: true }).decode(content);
        } catch {
            // Fall through to encoding detection.
        }
    }

    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(content);
    } catch {
        return new TextDecoder('euc-kr').decode(content);
    }
}

export function charsetFromMimeType(mimeType?: string): string | undefined {
    return mimeType?.match(/(?:^|;)\s*charset\s*=\s*["']?([^;"'\s]+)/i)?.[1];
}

function normalizeCharset(charset?: string): string | undefined {
    const normalized = charset?.trim().toLowerCase();
    if (!normalized) return undefined;
    if (normalized === 'utf8') return 'utf-8';
    if (normalized === 'cp949' || normalized === 'windows-949') return 'euc-kr';
    return normalized;
}

const HTML_ESCAPE_MAP: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
};

export function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (char) => HTML_ESCAPE_MAP[char] ?? char);
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
    if (bytes.length < prefix.length) return false;
    for (let index = 0; index < prefix.length; index += 1) {
        if (bytes[index] !== prefix[index]) return false;
    }
    return true;
}
