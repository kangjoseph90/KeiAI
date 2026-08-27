import { textDecoder, textEncoder } from '$lib/crypto';
import { AppError } from '$lib/types/errors';
import { unzip, zip } from '$lib/utils/zip';
import type { KeiModulePackageV1 } from './types';
import { isRecord, type KeiPackageExportMode } from '../utils';
import {
    keiPackageToRisuModule,
    readRisuModulePackage,
    risuModuleToKeiPackage,
    writeRisuModulePackage
} from './risu';
import { detectFileKind } from '$lib/utils/file';
import { readModuleCharX, writeModuleCharX } from './charx';

export type ModuleFileExport =
    | { kind: 'keimodule'; assetMode: KeiPackageExportMode }
    | { kind: 'risu'; format: 'charx' | 'risum' };

export async function readModuleFile(file: File): Promise<KeiModulePackageV1> {
    const name = file.name.toLowerCase();
    const bytes = new Uint8Array(await file.arrayBuffer());

    if (name.endsWith('.risum')) return readRisuModulePackage(bytes);
    if (name.endsWith('.charx')) return readModuleCharX(bytes);
    if (name.endsWith('.keimodule')) return readKeiModule(bytes);
    if (name.endsWith('.json')) return readModuleJson(bytes);

    const kind = detectFileKind(bytes);
    if (kind === 'json') return readModuleJson(bytes);
    if (kind === 'zip') return readModuleZip(bytes);
    try {
        return readRisuModulePackage(bytes);
    } catch {
        // Fall through to the user-facing unsupported-file error.
    }

    throw new AppError('INVALID_INPUT', `Unsupported module file: ${file.name}`);
}

export function writeModuleFile(pkg: KeiModulePackageV1, request: ModuleFileExport): Uint8Array {
    if (request.kind === 'risu' && request.format === 'risum') return writeRisuModulePackage(pkg);
    if (request.kind === 'risu' && request.format === 'charx') return writeModuleCharX(pkg);
    return writeKeiModule(pkg);
}

export function moduleFileExtension(request: ModuleFileExport): string {
    if (request.kind === 'keimodule') return 'keimodule';
    return request.format;
}

async function readKeiModule(bytes: Uint8Array): Promise<KeiModulePackageV1> {
    const entries = await unzip(bytes);
    return readKeiModuleEntries(entries);
}

async function readModuleZip(bytes: Uint8Array): Promise<KeiModulePackageV1> {
    const entries = await unzip(bytes);
    if (entries['package.json']) return readKeiModuleEntries(entries);
    if (entries['card.json']) return readModuleCharX(bytes);
    throw new AppError('INVALID_INPUT', 'Module archive is missing package.json or card.json');
}

function readKeiModuleEntries(entries: Record<string, Uint8Array>): KeiModulePackageV1 {
    const packageBytes = entries['package.json'];
    if (!packageBytes) throw new AppError('INVALID_INPUT', 'Kei module is missing package.json');
    return readModuleJson(packageBytes, entries);
}

function writeKeiModule(pkg: KeiModulePackageV1): Uint8Array {
    const entries: Record<string, Uint8Array> = {
        'package.json': textEncoder.encode(JSON.stringify(packageJson(pkg), null, 2))
    };
    for (const [key, asset] of Object.entries(pkg.assets)) {
        if (asset.data) entries[`assets/${key}.bin`] = asset.data;
    }
    return zip(entries);
}

function readModuleJson(
    bytes: Uint8Array,
    files: Record<string, Uint8Array> = {}
): KeiModulePackageV1 {
    const parsed = JSON.parse(textDecoder.decode(bytes)) as unknown;
    if (!isRecord(parsed)) throw new AppError('INVALID_INPUT', 'Invalid module JSON');
    if (parsed.kind === 'keiai.module' && parsed.version === 1) {
        const pkg = parsed as unknown as KeiModulePackageV1;
        const rawAssets = parsed.assets as Record<string, Record<string, unknown>> | undefined;
        const assets: Record<string, { data?: Uint8Array; hash?: string; encKey?: string }> = {};
        if (rawAssets) {
            for (const [key, asset] of Object.entries(rawAssets)) {
                if (!isRecord(asset)) {
                    throw new AppError('INVALID_INPUT', 'Invalid module asset');
                }
                const path = typeof asset.path === 'string' ? asset.path : undefined;
                assets[key] = {
                    data: path ? files[path] : undefined,
                    hash: typeof asset.hash === 'string' ? asset.hash : undefined,
                    encKey: typeof asset.encKey === 'string' ? asset.encKey : undefined
                };
            }
        }
        return { ...pkg, assets };
    }
    if (parsed.type === 'risuModule' && isRecord(parsed.module)) {
        return risuModuleToKeiPackage(parsed.module);
    }
    throw new AppError('INVALID_INPUT', 'Unsupported module JSON');
}

function packageJson(pkg: KeiModulePackageV1): unknown {
    return {
        ...pkg,
        assets: Object.fromEntries(
            Object.entries(pkg.assets).map(([key, asset]) => [
                key,
                {
                    path: asset.data ? `assets/${key}.bin` : undefined,
                    hash: asset.hash,
                    encKey: asset.encKey
                }
            ])
        )
    };
}
