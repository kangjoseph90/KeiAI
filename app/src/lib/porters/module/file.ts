import { AppError } from '$lib/types/errors';
import { unzip, zip } from '$lib/utils/zip';
import type { KeiModulePackageV1 } from './types';
import {
    keiPackageToRisuModule,
    readRisuModulePackage,
    risuModuleToKeiPackage,
    writeRisuModulePackage
} from './risu';

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

export type ModuleFileExport = { kind: 'keimodule' } | { kind: 'risu'; format: 'risum' };

export async function readModuleFile(file: File): Promise<KeiModulePackageV1> {
    const name = file.name.toLowerCase();
    const bytes = new Uint8Array(await file.arrayBuffer());

    if (name.endsWith('.risum')) return readRisuModulePackage(bytes);
    if (name.endsWith('.keimodule')) return readKeiModule(bytes);
    if (name.endsWith('.json')) return readModuleJson(bytes);

    throw new AppError('INVALID_INPUT', `Unsupported module file: ${file.name}`);
}

export function writeModuleFile(pkg: KeiModulePackageV1, request: ModuleFileExport): Uint8Array {
    if (request.kind === 'risu' && request.format === 'risum') return writeRisuModulePackage(pkg);
    return writeKeiModule(pkg);
}

export function moduleFileExtension(request: ModuleFileExport): string {
    if (request.kind === 'keimodule') return 'keimodule';
    return request.format;
}

async function readKeiModule(bytes: Uint8Array): Promise<KeiModulePackageV1> {
    const entries = await unzip(bytes);
    const packageBytes = entries['package.json'];
    if (!packageBytes) throw new AppError('INVALID_INPUT', 'Kei module is missing package.json');
    return readModuleJson(packageBytes, entries);
}

function writeKeiModule(pkg: KeiModulePackageV1): Uint8Array {
    const entries: Record<string, Uint8Array> = {
        'package.json': TEXT_ENCODER.encode(JSON.stringify(packageJson(pkg), null, 2))
    };
    for (const asset of pkg.assets) {
        if (asset.data) entries[`assets/${asset.id}.bin`] = asset.data;
    }
    return zip(entries);
}

function readModuleJson(
    bytes: Uint8Array,
    files: Record<string, Uint8Array> = {}
): KeiModulePackageV1 {
    const parsed = JSON.parse(TEXT_DECODER.decode(bytes)) as unknown;
    if (!isRecord(parsed)) throw new AppError('INVALID_INPUT', 'Invalid module JSON');
    if (parsed.kind === 'keiai.module' && parsed.version === 1) {
        const pkg = parsed as unknown as KeiModulePackageV1;
        return {
            ...pkg,
            assets: ((parsed as { assets?: unknown[] }).assets ?? []).map((asset) => {
                if (!isRecord(asset)) throw new AppError('INVALID_INPUT', 'Invalid module asset');
                const path = typeof asset.path === 'string' ? asset.path : undefined;
                return {
                    id: String(asset.id),
                    ...(path && files[path] ? { data: files[path] } : {}),
                    ...(typeof asset.hash === 'string' ? { hash: asset.hash } : {}),
                    ...(typeof asset.encKey === 'string' ? { encKey: asset.encKey } : {})
                };
            })
        };
    }
    if (parsed.type === 'risuModule' && isRecord(parsed.module)) {
        return risuModuleToKeiPackage(parsed.module);
    }
    throw new AppError('INVALID_INPUT', 'Unsupported module JSON');
}

function packageJson(pkg: KeiModulePackageV1): unknown {
    return {
        ...pkg,
        assets: pkg.assets.map((asset) => ({
            id: asset.id,
            ...(asset.data ? { path: `assets/${asset.id}.bin` } : {}),
            ...(asset.hash ? { hash: asset.hash } : {}),
            ...(asset.encKey ? { encKey: asset.encKey } : {})
        }))
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
