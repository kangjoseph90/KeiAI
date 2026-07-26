/**
 * Asset Utilities — KeiAI v3
 *
 * Image processing, hashing, and encryption utilities.
 */

import { sha256, sha256Bytes, fromHex, toHex, type Bytes } from '$lib/crypto';
import { mimeTypeFromName } from '$lib/utils/file';
import { preprocessImage } from '$lib/utils/image';
import { MAX_IMAGE_HEIGHT, MAX_IMAGE_WIDTH, WEBP_QUALITY } from './types';

export async function fileToPlaintext(
    file: File
): Promise<{ bytes: Uint8Array; mimeType: string }> {
    const sourceBytes = new Uint8Array(await file.arrayBuffer());
    const sourceMimeType = resolveFileMimeType(file, sourceBytes);
    const shouldPreprocess =
        sourceMimeType === 'image/png' ||
        sourceMimeType === 'image/jpeg' ||
        sourceMimeType === 'image/jpg';

    if (!shouldPreprocess) {
        return {
            bytes: sourceBytes,
            mimeType: sourceMimeType
        };
    }

    const { blob } = await preprocessImage(file, {
        maxWidth: MAX_IMAGE_WIDTH,
        maxHeight: MAX_IMAGE_HEIGHT,
        quality: WEBP_QUALITY
    });

    return {
        bytes: new Uint8Array(await blob.arrayBuffer()),
        mimeType: blob.type || 'image/webp'
    };
}

function resolveFileMimeType(file: File, bytes: Uint8Array): string {
    if (file.type && file.type !== 'application/octet-stream') return file.type;

    if (bytes.length >= 12) {
        const isWebP =
            bytes[0] === 0x52 &&
            bytes[1] === 0x49 &&
            bytes[2] === 0x46 &&
            bytes[3] === 0x46 &&
            bytes[8] === 0x57 &&
            bytes[9] === 0x45 &&
            bytes[10] === 0x42 &&
            bytes[11] === 0x50;
        if (isWebP) return 'image/webp';

        const isWav =
            bytes[0] === 0x52 &&
            bytes[1] === 0x49 &&
            bytes[2] === 0x46 &&
            bytes[3] === 0x46 &&
            bytes[8] === 0x57 &&
            bytes[9] === 0x41 &&
            bytes[10] === 0x56 &&
            bytes[11] === 0x45;
        if (isWav) return 'audio/wav';

        const isMp4 =
            bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
        if (isMp4) {
            return extensionOf(file.name) === 'm4a' ? 'audio/mp4' : 'video/mp4';
        }
    }

    if (bytes.length >= 4) {
        const isPng =
            bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
        const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
        const isGif =
            bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38;

        if (isPng) return 'image/png';
        if (isJpeg) return 'image/jpeg';
        if (isGif) return 'image/gif';

        const isOgg =
            bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53;
        if (isOgg) {
            return extensionOf(file.name) === 'ogg' && file.name.toLowerCase().includes('video')
                ? 'video/ogg'
                : 'audio/ogg';
        }

        const isWebM =
            bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
        if (isWebM) {
            const hasAudioCodec =
                includesAscii(bytes, 'A_OPUS') || includesAscii(bytes, 'A_VORBIS');
            const hasVideoCodec =
                includesAscii(bytes, 'V_VP8') ||
                includesAscii(bytes, 'V_VP9') ||
                includesAscii(bytes, 'V_AV1');
            return hasAudioCodec && !hasVideoCodec ? 'audio/webm' : 'video/webm';
        }

        const isMp3 =
            (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) ||
            (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
        if (isMp3) return 'audio/mpeg';
    }

    return mimeTypeFromName(file.name);
}

function extensionOf(fileName: string): string {
    const dot = fileName.lastIndexOf('.');
    return dot < 0 ? '' : fileName.slice(dot + 1).toLowerCase();
}

function includesAscii(bytes: Uint8Array, value: string): boolean {
    const first = value.charCodeAt(0);
    for (let offset = 0; offset <= bytes.length - value.length; offset += 1) {
        if (bytes[offset] !== first) continue;
        let matches = true;
        for (let index = 1; index < value.length; index += 1) {
            if (bytes[offset + index] !== value.charCodeAt(index)) {
                matches = false;
                break;
            }
        }
        if (matches) return true;
    }
    return false;
}

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
                salt: encoder.encode('kei-asset-salt'),
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
