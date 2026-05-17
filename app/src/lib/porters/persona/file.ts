import { AppError } from '$lib/types/errors';
import { imageToPng, isPng, readPng, writePngTextChunks } from '$lib/utils/png';
import { unzip, zip } from '$lib/utils/zip';
import { base64ToBytes, bytesToBase64 } from '../character/package';
import { normalizeCharacterMacros } from '../utils';
import type { KeiPersonaPackageV1 } from './types';

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();
const EMPTY_PNG = new Uint8Array([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 4, 0,
    0, 0, 181, 28, 12, 2, 0, 0, 0, 11, 73, 68, 65, 84, 120, 218, 99, 252, 255, 31, 0, 3, 3, 2, 0,
    239, 191, 167, 219, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130
]);

export type PersonaFileExport = { kind: 'keipersona' } | { kind: 'risu'; format: 'png' };

interface RisuPersonaCard {
    name: string;
    personaPrompt: string;
    note?: string;
}

export async function readPersonaFile(file: File): Promise<KeiPersonaPackageV1> {
    const name = file.name.toLowerCase();
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (name.endsWith('.png')) return readRisuPersonaPng(bytes);
    if (name.endsWith('.keipersona')) return readKeiPersona(bytes);
    throw new AppError('INVALID_INPUT', `Unsupported persona file: ${file.name}`);
}

export async function writePersonaFile(
    pkg: KeiPersonaPackageV1,
    request: PersonaFileExport
): Promise<Uint8Array> {
    if (request.kind === 'risu') return writeRisuPersonaPng(pkg);
    return writeKeiPersona(pkg);
}

export function personaFileExtension(request: PersonaFileExport): string {
    return request.kind === 'risu' ? request.format : 'keipersona';
}

async function readRisuPersonaPng(bytes: Uint8Array): Promise<KeiPersonaPackageV1> {
    const { chunks } = await readPng(bytes);
    const chunk = chunks.find((item) => item.key === 'persona');
    if (!chunk) throw new AppError('INVALID_INPUT', 'PNG is missing Risu persona chunk');

    const card = JSON.parse(TEXT_DECODER.decode(base64ToBytes(chunk.value))) as RisuPersonaCard;
    return {
        version: 1,
        kind: 'keiai.persona',
        persona: {
            name: card.name,
            description: normalizeCharacterMacros(card.personaPrompt),
            avatarAssetId: 'asset_0',
            assets: { refs: {}, folders: {} }
        },
        assets: [{ id: 'asset_0', data: bytes }]
    };
}

async function writeRisuPersonaPng(pkg: KeiPersonaPackageV1): Promise<Uint8Array> {
    const avatar = pkg.persona.avatarAssetId
        ? pkg.assets.find((asset) => asset.id === pkg.persona.avatarAssetId)?.data
        : undefined;
    const card: RisuPersonaCard = {
        name: pkg.persona.name,
        personaPrompt: pkg.persona.description
    };
    const png = avatar ? await imageToPng(avatar) : EMPTY_PNG;
    return writePngTextChunks(
        png ?? EMPTY_PNG,
        [{ key: 'persona', value: bytesToBase64(TEXT_ENCODER.encode(JSON.stringify(card))) }],
        ['persona']
    );
}

async function readKeiPersona(bytes: Uint8Array): Promise<KeiPersonaPackageV1> {
    const entries = await unzip(bytes);
    const packageBytes = entries['package.json'];
    if (!packageBytes) throw new AppError('INVALID_INPUT', 'Kei persona is missing package.json');
    const parsed = JSON.parse(TEXT_DECODER.decode(packageBytes)) as KeiPersonaPackageV1;
    return {
        ...parsed,
        assets: parsed.assets.map((asset) => ({
            ...asset,
            data: entries[`assets/${asset.id}.bin`]
        }))
    };
}

function writeKeiPersona(pkg: KeiPersonaPackageV1): Uint8Array {
    const entries: Record<string, Uint8Array> = {
        'package.json': TEXT_ENCODER.encode(
            JSON.stringify(
                {
                    ...pkg,
                    assets: pkg.assets.map((asset) => ({
                        id: asset.id,
                        ...(asset.data ? { path: `assets/${asset.id}.bin` } : {}),
                        ...(asset.hash ? { hash: asset.hash } : {}),
                        ...(asset.encKey ? { encKey: asset.encKey } : {})
                    }))
                },
                null,
                2
            )
        )
    };
    for (const asset of pkg.assets) {
        if (asset.data) entries[`assets/${asset.id}.bin`] = asset.data;
    }
    return zip(entries);
}
