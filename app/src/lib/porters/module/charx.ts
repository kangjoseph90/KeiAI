import { textDecoder } from '$lib/crypto';
import { readCharX, writeCharX } from '../character/charx';
import { parseCharacterCardV3 } from '../character/ccv3';
import type { KeiCharacterPackageV1 } from '../character/types';
import { unzip } from '$lib/utils/zip';
import { AppError } from '$lib/types/errors';
import type { KeiModulePackageV1 } from './types';

export async function readModuleCharX(bytes: Uint8Array): Promise<KeiModulePackageV1> {
    const entries = await unzip(bytes);
    const cardBytes = entries['card.json'];
    if (!cardBytes) {
        throw new AppError('INVALID_INPUT', 'Module CharX is missing card.json');
    }

    const card = parseCharacterCardV3(JSON.parse(textDecoder.decode(cardBytes)) as unknown);
    const pkg = await readCharX(bytes);
    return characterPackageToModulePackage(pkg, card.data.creator_notes);
}

export function writeModuleCharX(pkg: KeiModulePackageV1): Uint8Array {
    return writeCharX(modulePackageToCharacterPackage(pkg), {
        cardDescription: '',
        creatorNotes: pkg.module.description
    });
}

function modulePackageToCharacterPackage(pkg: KeiModulePackageV1): KeiCharacterPackageV1 {
    return {
        version: 1,
        kind: 'keiai.character',
        character: {
            name: pkg.module.name,
            description: pkg.module.description,
            characterNote: '',
            backgroundHTML: pkg.module.backgroundHTML,
            messageCSS: pkg.module.messageCSS,
            greetings: {},
            defaultVariables: { ...pkg.module.defaultVariables },
            allowLowLevel: pkg.module.allowLowLevel,
            lorebooks: pkg.module.lorebooks,
            scripts: pkg.module.scripts,
            charjs: pkg.module.charjs,
            assets: pkg.module.assets
        },
        assets: pkg.assets
    };
}

function characterPackageToModulePackage(
    pkg: KeiCharacterPackageV1,
    description: string
): KeiModulePackageV1 {
    return {
        version: 1,
        kind: 'keiai.module',
        module: {
            name: pkg.character.name,
            description,
            backgroundHTML: pkg.character.backgroundHTML,
            messageCSS: pkg.character.messageCSS,
            defaultVariables: { ...pkg.character.defaultVariables },
            toggles: { refs: {}, folders: {} },
            commands: { refs: {}, folders: {} },
            allowLowLevel: pkg.character.allowLowLevel,
            lorebooks: pkg.character.lorebooks,
            scripts: pkg.character.scripts,
            charjs: pkg.character.charjs,
            assets: pkg.character.assets
        },
        assets: pkg.assets
    };
}
