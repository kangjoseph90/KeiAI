/**
 * Binary cache values for TEXT storage (SQLite): base64 little-endian
 * Float32 under an f32: prefix; everything else stays plain JSON.
 */

const F32_PREFIX = 'f32:';

const HOST_IS_LITTLE_ENDIAN = new Uint8Array(new Float32Array([1]).buffer)[0] === 1;

function float32ToLEBytes(vector: Float32Array): Uint8Array {
    if (HOST_IS_LITTLE_ENDIAN && vector.byteOffset === 0) {
        return new Uint8Array(vector.buffer, 0, vector.byteLength);
    }
    const bytes = new Uint8Array(vector.length * 4);
    const view = new DataView(bytes.buffer);
    for (let index = 0; index < vector.length; index += 1) {
        view.setFloat32(index * 4, vector[index], true);
    }
    return bytes;
}

export function encodeFloat32Base64(vector: Float32Array): string {
    const bytes = float32ToLEBytes(vector);
    let binary = '';
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }
    return btoa(binary);
}

/** Decode little-endian Float32 bytes, swapping them first on big-endian hosts. */
export function float32FromLEBytes(
    bytes: Uint8Array,
    littleEndianHost: boolean = HOST_IS_LITTLE_ENDIAN
): Float32Array {
    if (bytes.length % 4 !== 0) {
        throw new Error('Encoded Float32 length must be a multiple of four bytes');
    }
    if (littleEndianHost) {
        return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const vector = new Float32Array(bytes.length / 4);
    for (let index = 0; index < vector.length; index += 1) {
        vector[index] = view.getFloat32(index * 4, true);
    }
    return vector;
}

export function decodeFloat32Base64(encoded: string): Float32Array {
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return float32FromLEBytes(bytes);
}

export function encodeCacheValue(value: unknown): string {
    if (value instanceof Float32Array) {
        return F32_PREFIX + encodeFloat32Base64(value);
    }
    return JSON.stringify(value);
}

export function decodeCacheValue(raw: string | null): unknown {
    if (raw === null) return null;
    if (raw.startsWith(F32_PREFIX)) {
        try {
            return decodeFloat32Base64(raw.slice(F32_PREFIX.length));
        } catch {
            return null;
        }
    }
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}
