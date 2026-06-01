import { AppError } from '$lib/types/errors';
import { imageToPng, readPng, writePngTextChunks } from '$lib/utils/png';
import { unzip, zip } from '$lib/utils/zip';
import { base64ToBytes, bytesToBase64 } from '../character/package';
import { denormalizeRisuTemplate, normalizeRisuTemplate } from '../risu/template';
import type { KeiPersonaPackageV1 } from './types';
import type { KeiPackageExportMode } from '../utils';

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();
const EMPTY_PNG = new Uint8Array([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 4, 0,
    0, 0, 181, 28, 12, 2, 0, 0, 0, 11, 73, 68, 65, 84, 120, 218, 99, 252, 255, 31, 0, 3, 3, 2, 0,
    239, 191, 167, 219, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130
]);

export type PersonaFileExport =
    | { kind: 'keipersona'; assetMode: KeiPackageExportMode }
    | { kind: 'risu'; format: 'png' };

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
            description: normalizeRisuTemplate(card.personaPrompt),
            assets: { refs: {}, folders: {} }
        },
        assets: {},
        avatar: { data: bytes }
    };
}

async function writeRisuPersonaPng(pkg: KeiPersonaPackageV1): Promise<Uint8Array> {
    const avatarData = pkg.avatar?.data;
    const card: RisuPersonaCard = {
        name: pkg.persona.name,
        personaPrompt: denormalizeRisuTemplate(pkg.persona.description)
    };
    const png = avatarData ? await imageToPng(avatarData) : EMPTY_PNG;
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
    const assets: Record<string, { data?: Uint8Array; hash?: string; encKey?: string }> = {};
    for (const [key, asset] of Object.entries(parsed.assets ?? {})) {
        assets[key] = {
            ...asset,
            data: entries[`assets/${key}.bin`]
        };
    }

    let avatar: { data?: Uint8Array; hash?: string; encKey?: string } | undefined;
    if (parsed.avatar) {
        avatar = {
            ...parsed.avatar,
            data: entries['assets/__avatar__.bin']
        };
    }

    return { ...parsed, assets, avatar };
}

function writeKeiPersona(pkg: KeiPersonaPackageV1): Uint8Array {
    const serializedAssets = Object.fromEntries(
        Object.entries(pkg.assets).map(([key, asset]) => [
            key,
            {
                path: asset.data ? `assets/${key}.bin` : undefined,
                hash: asset.hash,
                encKey: asset.encKey
            }
        ])
    );
    const serializedAvatar = pkg.avatar
        ? {
              path: pkg.avatar.data ? 'assets/__avatar__.bin' : undefined,
              hash: pkg.avatar.hash,
              encKey: pkg.avatar.encKey
          }
        : undefined;

    const entries: Record<string, Uint8Array> = {
        'package.json': TEXT_ENCODER.encode(
            JSON.stringify(
                {
                    ...pkg,
                    assets: serializedAssets,
                    avatar: serializedAvatar
                },
                null,
                2
            )
        )
    };
    for (const [key, asset] of Object.entries(pkg.assets)) {
        if (asset.data) entries[`assets/${key}.bin`] = asset.data;
    }
    if (pkg.avatar?.data) {
        entries['assets/__avatar__.bin'] = pkg.avatar.data;
    }
    return zip(entries);
}
