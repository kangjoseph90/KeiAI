import { AppError } from '$lib/types/errors';
import {
    imageToPng,
    isPng,
    readPng,
    writePngTextChunks,
    type PngInput,
    type PngTextChunk
} from '$lib/utils/png';
import { fromBase64, textDecoder, textEncoder, toBase64 } from '$lib/crypto';
import { assetPath, keiPackageToCard } from './card';
import { parseCharacterCardV3 } from './ccv3';
import { cardToKeiPackage } from './risu';
import type { KeiCharacterPackageV1 } from './types';

const EMPTY_PNG = new Uint8Array([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 4, 0,
    0, 0, 181, 28, 12, 2, 0, 0, 0, 11, 73, 68, 65, 84, 120, 218, 99, 252, 255, 31, 0, 3, 3, 2, 0,
    239, 191, 167, 219, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130
]);

export async function readCharacterPng(input: PngInput): Promise<KeiCharacterPackageV1> {
    const { bytes, chunks } = await readPng(input);
    const ccv3 = chunks.find((chunk) => chunk.key === 'ccv3');
    if (!ccv3) throw new AppError('INVALID_INPUT', 'PNG card is missing ccv3 chunk');

    const cardJson = textDecoder.decode(fromBase64(ccv3.value));
    const card = parseCharacterCardV3(JSON.parse(cardJson) as unknown);
    return cardToKeiPackage(card, readAssetChunks(chunks), bytes);
}

export async function writeCharacterPng(pkg: KeiCharacterPackageV1): Promise<Uint8Array> {
    const card = keiPackageToCard(pkg, 'png');
    const basePng = await basePngFor(pkg);
    const cardBytes = textEncoder.encode(JSON.stringify(card));

    const assetChunks: PngTextChunk[] = [];
    for (const [key, asset] of Object.entries(pkg.assets)) {
        if (!asset.data) continue;
        assetChunks.push({
            key: `chara-ext-asset_:${assetPath(pkg, key)}`,
            value: toBase64(asset.data)
        });
    }

    // Include avatar as a chunk so keiai extension roundtrip works.
    // The avatar is also used as the base PNG image, but the keiai
    // extension's fromKeiPackageJson needs the file in the map.
    if (pkg.avatar?.data) {
        assetChunks.push({
            key: `chara-ext-asset_:${assetPath(pkg, '__avatar__')}`,
            value: toBase64(pkg.avatar.data)
        });
    }

    const chunks: PngTextChunk[] = [{ key: 'ccv3', value: toBase64(cardBytes) }, ...assetChunks];

    return writePngTextChunks(basePng, chunks, ['ccv3', 'chara-ext-asset_*']);
}

function readAssetChunks(chunks: PngTextChunk[]): Record<string, Uint8Array> {
    const assets: Record<string, Uint8Array> = {};
    for (const chunk of chunks) {
        if (!chunk.key.startsWith('chara-ext-asset_:')) continue;
        const path = chunk.key.slice('chara-ext-asset_:'.length);
        assets[path] = fromBase64(chunk.value);
    }
    return assets;
}

async function basePngFor(pkg: KeiCharacterPackageV1): Promise<Uint8Array> {
    const avatarData = pkg.avatar?.data;
    if (!avatarData) return EMPTY_PNG;
    if (isPng(avatarData)) return avatarData;
    return (await imageToPng(avatarData)) ?? EMPTY_PNG;
}
