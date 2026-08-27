import { AppError } from '$lib/types/errors';
import type { SerializedKeiAssetPayload } from '../types';
import type { KeiCharacterPackageV1, SerializedKeiCharacterPackageV1 } from './types';

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

export function toKeiPackageJson(
    pkg: KeiCharacterPackageV1,
    options: { assetPath?: (key: string) => string | undefined } = {}
): SerializedKeiCharacterPackageV1 {
    const avatarPath = options.assetPath?.('__avatar__');
    return {
        ...pkg,
        assets: Object.fromEntries(
            Object.entries(pkg.assets).map(([key, asset]): [string, SerializedKeiAssetPayload] => {
                const path = asset.data ? options.assetPath?.(key) : undefined;
                return [
                    key,
                    {
                        path,
                        hash: asset.hash,
                        encKey: asset.encKey
                    }
                ];
            })
        ),
        avatar: pkg.avatar
            ? {
                  path: pkg.avatar.data ? avatarPath : undefined,
                  hash: pkg.avatar.hash,
                  encKey: pkg.avatar.encKey
              }
            : undefined
    };
}

export function writeKeiPackageJson(
    pkg: KeiCharacterPackageV1,
    options: { assetPath?: (key: string) => string | undefined } = {}
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

    const assets: Record<string, { data?: Uint8Array; hash?: string; encKey?: string }> = {};
    for (const [key, asset] of Object.entries(value.assets ?? {})) {
        if (typeof asset !== 'object' || asset === null) continue;
        const a = asset as Record<string, unknown>;
        const data = typeof a.path === 'string' ? files[a.path] : undefined;

        if (typeof a.path === 'string' && !data) {
            throw new AppError('INVALID_INPUT', `Missing KeiAI asset payload: ${a.path}`);
        }

        assets[key] = {
            data,
            hash: typeof a.hash === 'string' ? a.hash : undefined,
            encKey: typeof a.encKey === 'string' ? a.encKey : undefined
        };
    }

    let avatar: { data?: Uint8Array; hash?: string; encKey?: string } | undefined;
    if (value.avatar) {
        const a = value.avatar as Record<string, unknown>;
        const avatarPath = typeof a.path === 'string' ? a.path : undefined;
        const avatarData = avatarPath ? files[avatarPath] : undefined;

        if (avatarPath && !avatarData) {
            throw new AppError('INVALID_INPUT', `Missing KeiAI avatar payload: ${avatarPath}`);
        }

        avatar = {
            data: avatarData,
            hash: typeof a.hash === 'string' ? a.hash : undefined,
            encKey: typeof a.encKey === 'string' ? a.encKey : undefined
        };
    }

    return {
        ...value,
        assets,
        avatar
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

interface SerializedAssetEntry {
    path?: string;
    hash?: string;
    encKey?: string;
}

function isKeiPackageJson(
    value: unknown
): value is SerializedKeiCharacterPackageV1 & { avatar?: SerializedAssetEntry } {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    return (
        record.version === 1 &&
        record.kind === 'keiai.character' &&
        typeof record.assets === 'object'
    );
}
