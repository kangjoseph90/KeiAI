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
    for (let index = 0; index < signature.length; index += 1) {
        if (bytes[index] !== signature[index]) return false;
    }
    return true;
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

export function createTimestampedFileName(
    prefix: string,
    extension: string,
    date = new Date()
): string {
    const pad = (value: number) => String(value).padStart(2, '0');
    const timestamp =
        `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
        `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
    return `${prefix} ${timestamp}.${extension}`;
}

export function withDetectedExtension(name: string, kind: DetectedFileKind): string {
    if (/\.[a-z0-9]{1,16}$/i.test(name)) return name;
    const extension = extensionForFileKind(kind);
    return extension ? `${name}.${extension}` : name;
}

const EXTENSION_MIME_TYPES: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    m4a: 'audio/mp4',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    txt: 'text/plain',
    log: 'text/plain',
    md: 'text/markdown',
    markdown: 'text/markdown',
    csv: 'text/csv',
    tsv: 'text/tab-separated-values',
    html: 'text/html',
    htm: 'text/html',
    css: 'text/css',
    xml: 'application/xml',
    yaml: 'application/x-yaml',
    yml: 'application/x-yaml',
    toml: 'application/toml',
    sql: 'application/sql',
    js: 'text/javascript',
    jsx: 'text/javascript',
    ts: 'text/javascript',
    tsx: 'text/javascript',
    py: 'text/plain',
    java: 'text/plain',
    kt: 'text/plain',
    kts: 'text/plain',
    c: 'text/plain',
    h: 'text/plain',
    cpp: 'text/plain',
    hpp: 'text/plain',
    cs: 'text/plain',
    go: 'text/plain',
    rs: 'text/plain',
    rb: 'text/plain',
    php: 'text/plain',
    swift: 'text/plain',
    sh: 'text/plain',
    bash: 'text/plain',
    zsh: 'text/plain',
    ps1: 'text/plain',
    json: 'application/json',
    keipreset: 'application/json',
    zip: 'application/zip',
    charx: 'application/zip',
    keichar: 'application/zip',
    keimodule: 'application/zip',
    keipersona: 'application/zip'
};

export function mimeTypeFromName(name: string): string {
    const extension = name.split('.').pop()?.toLowerCase();
    if (!extension || !Object.hasOwn(EXTENSION_MIME_TYPES, extension)) {
        return 'application/octet-stream';
    }
    return EXTENSION_MIME_TYPES[extension];
}
