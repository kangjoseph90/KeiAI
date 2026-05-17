import { AppError } from '$lib/types/errors';
import {
    isPng,
    readPng,
    writePngTextChunks,
    type PngInput,
    type PngTextChunk
} from '$lib/utils/png';
import { assetPath, keiPackageToCard } from './card';
import { parseCharacterCardV3 } from './ccv3';
import { base64ToBytes, bytesToBase64 } from './package';
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

    const cardJson = new TextDecoder().decode(base64ToBytes(ccv3.value));
    const card = parseCharacterCardV3(JSON.parse(cardJson) as unknown);
    return cardToKeiPackage(card, readAssetChunks(chunks), bytes);
}

export async function writeCharacterPng(pkg: KeiCharacterPackageV1): Promise<Uint8Array> {
    const card = keiPackageToCard(pkg, 'png');
    const basePng = await basePngFor(pkg);
    const cardBytes = new TextEncoder().encode(JSON.stringify(card));
    const chunks: PngTextChunk[] = [
        { key: 'ccv3', value: bytesToBase64(cardBytes) },
        ...pkg.assets
            .filter((asset) => asset.data)
            .map((asset) => ({
                key: `chara-ext-asset_:${assetPath(pkg, asset.id)}`,
                value: bytesToBase64(asset.data as Uint8Array)
            }))
    ];

    return writePngTextChunks(basePng, chunks, ['ccv3', 'chara-ext-asset_*']);
}

function readAssetChunks(chunks: PngTextChunk[]): Record<string, Uint8Array> {
    const assets: Record<string, Uint8Array> = {};
    for (const chunk of chunks) {
        if (!chunk.key.startsWith('chara-ext-asset_:')) continue;
        const path = chunk.key.slice('chara-ext-asset_:'.length);
        assets[path] = base64ToBytes(chunk.value);
    }
    return assets;
}

async function basePngFor(pkg: KeiCharacterPackageV1): Promise<Uint8Array> {
    const avatar = pkg.character.avatarAssetId
        ? pkg.assets.find((asset) => asset.id === pkg.character.avatarAssetId)?.data
        : undefined;
    if (!avatar) return EMPTY_PNG;
    if (isPng(avatar)) return avatar;
    return (await convertImageToPng(avatar)) ?? EMPTY_PNG;
}

async function convertImageToPng(bytes: Uint8Array): Promise<Uint8Array | null> {
    if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null;
    const bitmap = await createImageBitmap(new Blob([bytes.slice()])).catch(() => null);
    if (!bitmap) return null;

    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);

    const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, 'image/png');
    });
    if (!blob) return null;
    return new Uint8Array(await blob.arrayBuffer());
}
