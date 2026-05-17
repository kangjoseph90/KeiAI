import { AppError } from '$lib/types/errors';
import { unzip, zip, type ZipInput } from '$lib/utils/zip';
import { readKeiPackageJson, writeKeiPackageJson } from './package';
import type { KeiCharacterPackageV1 } from './types';

export function writeKeiChar(pkg: KeiCharacterPackageV1): Uint8Array {
    const entries: Record<string, Uint8Array> = {
        'package.json': writeKeiPackageJson(pkg, {
            assetPath: (id) => `assets/${id}.bin`
        })
    };

    for (const asset of pkg.assets) {
        if (asset.data) entries[`assets/${asset.id}.bin`] = asset.data;
    }

    return zip(entries);
}

export async function readKeiChar(input: ZipInput): Promise<KeiCharacterPackageV1> {
    const entries = await unzip(input);
    const packageBytes = entries['package.json'];
    if (!packageBytes) {
        throw new AppError('INVALID_INPUT', 'KeiChar is missing package.json');
    }
    return readKeiPackageJson(packageBytes, entries);
}
