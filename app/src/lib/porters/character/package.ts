import { AppError } from '$lib/types/errors';
import type { SerializedKeiAssetPayload } from '../types';
import type { KeiCharacterPackageV1, SerializedKeiCharacterPackageV1 } from './types';

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

export function toKeiPackageJson(
    pkg: KeiCharacterPackageV1,
    options: { assetPath?: (id: string) => string | undefined } = {}
): SerializedKeiCharacterPackageV1 {
    return {
        ...pkg,
        assets: pkg.assets.map((asset): SerializedKeiAssetPayload => {
            const path = options.assetPath?.(asset.id);
            return {
                id: asset.id,
                ...(path ? { path } : {}),
                ...(asset.hash ? { hash: asset.hash } : {}),
                ...(asset.encKey ? { encKey: asset.encKey } : {})
            };
        })
    };
}

export function writeKeiPackageJson(
    pkg: KeiCharacterPackageV1,
    options: { assetPath?: (id: string) => string | undefined } = {}
): Uint8Array {
    return TEXT_ENCODER.encode(JSON.stringify(toKeiPackageJson(pkg, options), null, 2));
}

export function fromKeiPackageJson(
    value: unknown,
    files: Record<string, Uint8Array> = {}
): KeiCharacterPackageV1 {
    if (!isKeiPackageJson(value)) {
        throw new AppError('INVALID_INPUT', 'Unsupported KeiAI character package');
    }

    return {
        ...value,
        assets: value.assets.map((asset) => {
            const data = asset.path ? files[asset.path] : undefined;

            if (asset.path && !data) {
                throw new AppError('INVALID_INPUT', `Missing KeiAI asset payload: ${asset.path}`);
            }

            return {
                id: asset.id,
                ...(data ? { data } : {}),
                ...(asset.hash ? { hash: asset.hash } : {}),
                ...(asset.encKey ? { encKey: asset.encKey } : {})
            };
        })
    };
}

export function readKeiPackageJson(
    bytes: Uint8Array,
    files: Record<string, Uint8Array> = {}
): KeiCharacterPackageV1 {
    const text = TEXT_DECODER.decode(bytes);
    const json = JSON.parse(text) as unknown;
    return fromKeiPackageJson(json, files);
}

export function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
}

function isKeiPackageJson(value: unknown): value is SerializedKeiCharacterPackageV1 {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    return (
        record.version === 1 && record.kind === 'keiai.character' && Array.isArray(record.assets)
    );
}
