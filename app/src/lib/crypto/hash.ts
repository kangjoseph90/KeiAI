/**
 * SHA-256 Hashing Implementation.
 * Optimized to handle both strings and raw bytes.
 */

type Bytes = Uint8Array<ArrayBuffer>;

/**
 * Calculate SHA-256 hash of a buffer or string.
 * Returns the hex representation of the hash.
 */
export async function sha256(data: Bytes | ArrayBuffer | string): Promise<string> {
    let buffer: BufferSource;

    if (typeof data === 'string') {
        buffer = new TextEncoder().encode(data);
    } else if (data instanceof Uint8Array) {
        buffer = data.buffer as ArrayBuffer;
    } else {
        buffer = data;
    }

    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Calculate SHA-256 hash and return raw bytes.
 */
export async function sha256Bytes(data: Bytes | ArrayBuffer | string): Promise<Bytes> {
    let buffer: BufferSource;

    if (typeof data === 'string') {
        buffer = new TextEncoder().encode(data);
    } else if (data instanceof Uint8Array) {
        buffer = data.buffer as ArrayBuffer;
    } else {
        buffer = data;
    }

    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    return new Uint8Array(hashBuffer);
}
