import { AppError } from '$lib/types/errors';
import { unzip, zip, type ZipInput } from '$lib/utils/zip';
import { readKeiPackageJson, writeKeiPackageJson } from './package';
import type { KeiCharacterPackageV1 } from './types';

export function writeKeiChar(pkg: KeiCharacterPackageV1): Uint8Array {
    const entries: Record<string, Uint8Array> = {
        'package.json': writeKeiPackageJson(pkg, {
            assetPath: (key) => `assets/${key}.bin`
        })
    };

    for (const [key, asset] of Object.entries(pkg.assets)) {
        if (asset.data) entries[`assets/${key}.bin`] = asset.data;
    }

    if (pkg.avatar?.data) {
        entries['assets/__avatar__.bin'] = pkg.avatar.data;
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
