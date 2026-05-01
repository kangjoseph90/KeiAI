/**
 * Device Pairing Cryptography
 *
 * Implements the HKDF-split QR pairing flow.
 * The server never receives the raw pairing code. It only receives
 * the SHA-256 hash of the lookup-derived key, and an AES-GCM encrypted
 * blob containing the master key and identity key pair.
 */

import { deriveHKDF, importWrappingKey } from './kdf';
import { sha256 } from './hash';
import { encryptBytes, decryptBytes } from './encryption';
import {
    exportPrivateKey,
    exportPublicKey,
    importPrivateKey,
    importPublicKey
} from './identityKey';
import { toBase64, fromBase64 } from './encoding';

const PAIRING_CHARSET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const PAIRING_CODE_LENGTH = 8;

export interface PairingPayload {
    userId: string;
    username: string;
    rawM: string; // Base64
    publicKeyJwk: JsonWebKey;
    rawPrivateKey: string; // Base64
    pbToken?: string;
}

export interface CreatePairingBlobArgs {
    pairingCode: string;
    userId: string;
    username: string;
    masterKey: CryptoKey;
    identityKeyPair: CryptoKeyPair;
    pbToken?: string;
}

/**
 * Generate an 8-character random pairing code.
 */
export function generatePairingCode(): string {
    const values = crypto.getRandomValues(new Uint8Array(PAIRING_CODE_LENGTH));
    let code = '';
    for (const byte of values) {
        code += PAIRING_CHARSET[byte % PAIRING_CHARSET.length];
    }
    return code;
}

/**
 * Derive the lookup ID and encryption key from a pairing code.
 */
export async function derivePairingKeys(pairingCode: string) {
    const lookupMaterial = await deriveHKDF(pairingCode, 'lookup');
    const lookupId = await sha256(lookupMaterial);

    const encKeyBytes = await deriveHKDF(pairingCode, 'encrypt');
    const encKey = await importWrappingKey(encKeyBytes, false);

    return { lookupId, encKey, encKeyBytes };
}

/**
 * Create the encrypted pairing blob.
 */
export async function createPairingBlob(
    args: CreatePairingBlobArgs
): Promise<{ lookupId: string; blob: string }> {
    const { lookupId, encKey, encKeyBytes } = await derivePairingKeys(args.pairingCode);

    const rawM = new Uint8Array(
        (await crypto.subtle.exportKey('raw', args.masterKey)) as ArrayBuffer
    );
    let rawPrivateKey: Uint8Array<ArrayBuffer> | null = null;

    try {
        const publicKeyJwk = await exportPublicKey(args.identityKeyPair.publicKey);
        rawPrivateKey = await exportPrivateKey(args.identityKeyPair.privateKey);

        const payload: PairingPayload = {
            userId: args.userId,
            username: args.username,
            rawM: toBase64(rawM),
            publicKeyJwk,
            rawPrivateKey: toBase64(rawPrivateKey),
            pbToken: args.pbToken
        };

        const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
        const { ciphertext, iv } = await encryptBytes(encKey, payloadBytes);

        return {
            lookupId,
            blob: JSON.stringify({
                ciphertext: toBase64(ciphertext),
                iv: toBase64(iv)
            })
        };
    } finally {
        rawM.fill(0);
        rawPrivateKey?.fill(0);
        encKeyBytes.fill(0);
    }
}

/**
 * Decrypt the pairing blob to extract the identity.
 */
export async function decryptPairingBlob(
    pairingCode: string,
    blobJson: string
): Promise<{
    userId: string;
    username: string;
    masterKey: CryptoKey;
    identityKeyPair: CryptoKeyPair;
    pbToken?: string;
}> {
    const { encKey, encKeyBytes } = await derivePairingKeys(pairingCode);

    let rawM: Uint8Array<ArrayBuffer> | null = null;
    let rawPrivateKey: Uint8Array<ArrayBuffer> | null = null;

    try {
        const parsed = JSON.parse(blobJson);
        const ciphertext = fromBase64(parsed.ciphertext);
        const iv = fromBase64(parsed.iv);

        const payloadBytes = await decryptBytes(encKey, { ciphertext, iv });
        const payloadStr = new TextDecoder().decode(payloadBytes);
        const payload = JSON.parse(payloadStr) as PairingPayload;

        rawM = fromBase64(payload.rawM);
        const masterKey = await crypto.subtle.importKey('raw', rawM, { name: 'AES-GCM' }, true, [
            'encrypt',
            'decrypt'
        ]);

        const publicKey = await importPublicKey(payload.publicKeyJwk);
        rawPrivateKey = fromBase64(payload.rawPrivateKey);
        const privateKey = await importPrivateKey(rawPrivateKey, true);

        return {
            userId: payload.userId,
            username: payload.username,
            masterKey,
            identityKeyPair: { publicKey, privateKey },
            pbToken: payload.pbToken
        };
    } finally {
        rawM?.fill(0);
        rawPrivateKey?.fill(0);
        encKeyBytes.fill(0);
    }
}
