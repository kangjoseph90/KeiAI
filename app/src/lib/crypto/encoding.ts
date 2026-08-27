/**
 * Binary encoding / decoding utilities.
 *
 * Supports conversion between:
 *   - Raw bytes (Uint8Array)
 *   - Base64 strings (for JSON storage)
 *   - Hex strings (for URL hashes and encryption keys)
 *   - Data URLs (for inline media)
 */

type Bytes = Uint8Array<ArrayBuffer>;

/** Chunk size keeps String.fromCharCode arguments under engine limits. */
const BASE64_CHUNK_SIZE = 0x8000;

/** Shared stateless codecs; constructing them per call is wasted work. */
export const textEncoder = new TextEncoder();
export const textDecoder = new TextDecoder();

/**
 * Narrow a byte view to an ArrayBuffer-backed one without copying.
 *
 * Public APIs annotate bytes as `Uint8Array` (which allows SharedArrayBuffer
 * views), but runtime data in this app is always ArrayBuffer-backed. WebCrypto
 * accepts only the backed form, so narrow once here instead of copying.
 */
export function asBytes(bytes: Uint8Array): Bytes {
    return bytes as Bytes;
}

/**
 * Build a `data:` URL from an already base64-encoded payload.
 */
export function toDataUrl(mimeType: string, base64: string): string {
    return `data:${mimeType};base64,${base64}`;
}

/**
 * Convert raw bytes to a Base64 string.
 */
export function toBase64(bytes: Uint8Array<ArrayBufferLike>): string {
    let binary = '';
    for (let index = 0; index < bytes.length; index += BASE64_CHUNK_SIZE) {
        binary += String.fromCharCode.apply(
            null,
            bytes.subarray(index, index + BASE64_CHUNK_SIZE) as unknown as number[]
        );
    }
    return btoa(binary);
}

/**
 * Convert a Base64 string back to raw bytes.
 */
export function fromBase64(base64: string): Bytes {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

/** Byte value → two hex characters, and hex character → nibble for parsing. */
const HEX_CHARS = '0123456789abcdef';
const HEX_TABLE: readonly string[] = Array.from(
    { length: 256 },
    (_, value) => HEX_CHARS[value >> 4] + HEX_CHARS[value & 0xf]
);
const HEX_VALUES = new Uint8Array(128);
for (let value = 0; value < 16; value += 1) {
    HEX_VALUES[HEX_CHARS.charCodeAt(value)] = value;
    HEX_VALUES[HEX_CHARS.toUpperCase().charCodeAt(value)] = value;
}

/**
 * Convert raw bytes to a Hex string.
 */
export function toHex(bytes: Bytes | ArrayBuffer): string {
    const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let hex = '';
    for (let index = 0; index < array.length; index += 1) {
        hex += HEX_TABLE[array[index]];
    }
    return hex;
}

/**
 * Convert a Hex string back to raw bytes.
 */
export function fromHex(hex: string): Bytes {
    const normalizedHex = hex.startsWith('0x') ? hex.slice(2) : hex;
    const pairCount = normalizedHex.length >> 1;
    const bytes = new Uint8Array(pairCount + (normalizedHex.length % 2));

    let index = 0;
    for (; index < pairCount; index += 1) {
        bytes[index] =
            (nibbleAt(normalizedHex, index * 2) << 4) | nibbleAt(normalizedHex, index * 2 + 1);
    }
    if (index < bytes.length) bytes[index] = nibbleAt(normalizedHex, index * 2);
    return bytes;
}

/** Unknown or missing digits read as 0, matching the previous parseInt behavior. */
function nibbleAt(text: string, position: number): number {
    return HEX_VALUES[text.charCodeAt(position)] ?? 0;
}
