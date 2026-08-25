import { charsetFromMimeType, decodeTextBytes } from '$lib/utils/text';

function copyBuffer(data: Uint8Array): ArrayBuffer {
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    return copy.buffer;
}

export async function createRenderBlob(source: Blob | Uint8Array, mimeType: string): Promise<Blob> {
    const normalized = mimeType.trim().toLowerCase();
    if (!normalized.startsWith('text/plain')) {
        if (source instanceof Blob) return source.slice(0, source.size, normalized);
        return new Blob([copyBuffer(source)], { type: normalized });
    }

    const bytes =
        source instanceof Blob
            ? new Uint8Array(await source.arrayBuffer())
            : new Uint8Array(copyBuffer(source));
    // The decoded text is re-encoded as UTF-8, so the rendered blob must declare UTF-8
    // regardless of the charset the stored asset was written with.
    return new Blob([decodeTextBytes(bytes, charsetFromMimeType(normalized))], {
        type: 'text/plain;charset=utf-8'
    });
}
