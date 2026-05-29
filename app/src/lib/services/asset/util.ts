/**
 * Asset Utilities — KeiAI v3
 *
 * Image processing, hashing, and encryption utilities.
 */

import { sha256, sha256Bytes, fromHex, toHex, type Bytes } from '$lib/crypto';
import type { AssetFields } from '$lib/adapters/asset';

// ─── Convergent Encryption ───────────────────────────────────────────

function asWebCryptoBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
    const buffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;
    return new Uint8Array(buffer);
}

async function hkdfBytes(ikm: Uint8Array, info: string, outputBits: number): Promise<Bytes> {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey('raw', asWebCryptoBytes(ikm), 'HKDF', false, [
        'deriveBits'
    ]);

    return new Uint8Array(
        (await crypto.subtle.deriveBits(
            {
                name: 'HKDF',
                hash: 'SHA-256',
                salt: encoder.encode('kei:asset-v3'),
                info: encoder.encode(info)
            },
            keyMaterial,
            outputBits
        )) as ArrayBuffer
    );
}

async function importAssetCryptoKey(keyBytes: Uint8Array): Promise<CryptoKey> {
    return crypto.subtle.importKey('raw', asWebCryptoBytes(keyBytes), { name: 'AES-GCM' }, false, [
        'encrypt',
        'decrypt'
    ]);
}

async function deriveAssetIv(encKeyBytes: Uint8Array): Promise<Bytes> {
    return hkdfBytes(encKeyBytes, 'kei-asset-iv', 96);
}

/**
 * Encrypt asset plaintext using convergent encryption.
 *
 * Same plaintext produces the same encKey, IV, ciphertext, and ciphertext hash.
 * plaintextHash is internal keying material only and must not be exported.
 */
export async function encryptConvergentAsset(
    data: Uint8Array | ArrayBuffer
): Promise<{ ciphertext: Uint8Array; hash: string; encKey: string }> {
    const plaintext = data instanceof Uint8Array ? data : new Uint8Array(data);
    const plaintextHash = await sha256Bytes(plaintext as unknown as Bytes);
    const encKeyBytes = await hkdfBytes(plaintextHash, 'kei-asset-enc', 256);
    const iv = await deriveAssetIv(encKeyBytes);
    const cryptoKey = await importAssetCryptoKey(encKeyBytes);

    const ciphertext = new Uint8Array(
        (await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: asWebCryptoBytes(iv) },
            cryptoKey,
            asWebCryptoBytes(plaintext)
        )) as ArrayBuffer
    );
    const hash = await sha256(ciphertext as unknown as Bytes);
    const encKey = toHex(encKeyBytes);

    plaintextHash.fill(0);
    encKeyBytes.fill(0);
    iv.fill(0);

    return { ciphertext, hash, encKey };
}

/**
 * Decrypt convergently encrypted asset bytes using the stored encKey.
 */
export async function decryptConvergentAsset(
    ciphertext: Uint8Array,
    encKeyHex: string
): Promise<Uint8Array> {
    const encKeyBytes = fromHex(encKeyHex);
    const iv = await deriveAssetIv(encKeyBytes);
    const cryptoKey = await importAssetCryptoKey(encKeyBytes);

    try {
        return new Uint8Array(
            (await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: asWebCryptoBytes(iv) },
                cryptoKey,
                asWebCryptoBytes(ciphertext)
            )) as ArrayBuffer
        );
    } finally {
        encKeyBytes.fill(0);
        iv.fill(0);
    }
}

/** Check if bytes start with a valid image magic number */
export function isValidImageHeader(bytes: Uint8Array): boolean {
    if (bytes.length < 4) return false;

    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const isWebP =
        bytes[0] === 0x52 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x46 &&
        bytes.length >= 12 &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50;
    const isGif = bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38;

    return isPng || isJpeg || isWebP || isGif;
}

// ─── Asset Field Parsing ─────────────────────────────────────────────

/** Parse plaintext data from a DataRecord */
export function parseFields(record: { data: Record<string, unknown> }): AssetFields {
    return record.data as unknown as AssetFields;
}
