export type DetectedFileKind = 'png' | 'jpeg' | 'gif' | 'webp' | 'zip' | 'json' | 'unknown';

export function detectFileKind(bytes: Uint8Array): DetectedFileKind {
    if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
    if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
    if (asciiAt(bytes, 0, 'GIF87a') || asciiAt(bytes, 0, 'GIF89a')) return 'gif';
    if (asciiAt(bytes, 0, 'RIFF') && asciiAt(bytes, 8, 'WEBP')) return 'webp';
    if (
        startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) ||
        startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]) ||
        startsWith(bytes, [0x50, 0x4b, 0x07, 0x08])
    ) {
        return 'zip';
    }

    let offset = startsWith(bytes, [0xef, 0xbb, 0xbf]) ? 3 : 0;
    while (offset < bytes.length && isJsonWhitespace(bytes[offset])) offset += 1;
    if (bytes[offset] === 0x7b || bytes[offset] === 0x5b) return 'json';

    return 'unknown';
}

export function mimeTypeForFileKind(kind: DetectedFileKind): string {
    if (kind === 'png') return 'image/png';
    if (kind === 'jpeg') return 'image/jpeg';
    if (kind === 'gif') return 'image/gif';
    if (kind === 'webp') return 'image/webp';
    if (kind === 'zip') return 'application/zip';
    if (kind === 'json') return 'application/json';
    return 'application/octet-stream';
}

export function extensionForFileKind(kind: DetectedFileKind): string | null {
    if (kind === 'jpeg') return 'jpg';
    if (kind === 'unknown') return null;
    return kind;
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
    if (bytes.length < signature.length) return false;
    return signature.every((value, index) => bytes[index] === value);
}

function asciiAt(bytes: Uint8Array, offset: number, value: string): boolean {
    if (bytes.length < offset + value.length) return false;
    for (let index = 0; index < value.length; index += 1) {
        if (bytes[offset + index] !== value.charCodeAt(index)) return false;
    }
    return true;
}

function isJsonWhitespace(value: number | undefined): boolean {
    return value === 0x20 || value === 0x09 || value === 0x0a || value === 0x0d;
}

export function sanitizeFileName(value: string): string {
    // eslint-disable-next-line no-control-regex
    return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '') || 'file';
}

export function fileNameFromPath(path: string): string {
    const withoutQuery = path.split(/[?#]/, 1)[0];
    const encodedName = withoutQuery.split(/[\\/]/).pop() || 'file';
    try {
        return decodeURIComponent(encodedName) || 'file';
    } catch {
        return encodedName;
    }
}

export function withDetectedExtension(name: string, kind: DetectedFileKind): string {
    if (/\.[a-z0-9]{1,16}$/i.test(name)) return name;
    const extension = extensionForFileKind(kind);
    return extension ? `${name}.${extension}` : name;
}

export function mimeTypeFromName(name: string): string {
    const extension = name.split('.').pop()?.toLowerCase();
    if (extension === 'png') return 'image/png';
    if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
    if (extension === 'webp') return 'image/webp';
    if (extension === 'gif') return 'image/gif';
    if (extension === 'json' || extension === 'keipreset') return 'application/json';
    if (
        extension === 'zip' ||
        extension === 'charx' ||
        extension === 'keichar' ||
        extension === 'keimodule' ||
        extension === 'keipersona'
    ) {
        return 'application/zip';
    }
    return 'application/octet-stream';
}
