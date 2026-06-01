import { AppError } from '$lib/types/errors';
import { unzip, zip, type ZipInput } from '$lib/utils/zip';
import { assetPath, keiPackageToCard, keiPackageToRisuModule } from './card';
import { parseCharacterCardV3, type CharacterBookEntry } from './ccv3';
import { readRisuModule, writeRisuModule, type RisuInternalLorebook } from '../risu/module';
import { cardToKeiPackage } from './risu';
import type { KeiCharacterPackageV1 } from './types';

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

export async function readCharX(input: ZipInput): Promise<KeiCharacterPackageV1> {
    const entries = await unzip(input);
    const cardBytes = entries['card.json'];
    if (!cardBytes) {
        throw new AppError('INVALID_INPUT', 'CharX is missing card.json');
    }

    const card = parseCharacterCardV3(JSON.parse(TEXT_DECODER.decode(cardBytes)) as unknown);
    const moduleBytes = entries['module.risum'];
    if (moduleBytes) {
        const module = readRisuModule(moduleBytes);
        card.data.extensions.risuai ??= {};
        if (module.trigger) card.data.extensions.risuai.triggerscript = module.trigger;
        if (module.regex) card.data.extensions.risuai.customScripts = module.regex;
        if (module.lorebook?.length && !card.data.character_book?.entries?.length) {
            card.data.character_book = {
                extensions: {},
                entries: module.lorebook.map(moduleLorebookToEntry)
            };
        }
    }

    return cardToKeiPackage(card, entries);
}

export function writeCharX(pkg: KeiCharacterPackageV1): Uint8Array {
    const card = keiPackageToCard(pkg, 'charx');
    const entries: Record<string, Uint8Array> = {
        'card.json': TEXT_ENCODER.encode(JSON.stringify(card, null, 2)),
        'module.risum': writeRisuModule(keiPackageToRisuModule(pkg))
    };

    for (const [key, asset] of Object.entries(pkg.assets)) {
        if (asset.data) entries[assetPath(pkg, key)] = asset.data;
    }
    if (pkg.avatar?.data) {
        entries[assetPath(pkg, '__avatar__')] = pkg.avatar.data;
    }

    return zip(entries);
}

function moduleLorebookToEntry(lorebook: RisuInternalLorebook): CharacterBookEntry {
    return {
        keys: splitKeys(lorebook.key),
        secondary_keys: lorebook.selective ? splitKeys(lorebook.secondkey ?? '') : undefined,
        content: lorebook.content,
        extensions: {},
        enabled: true,
        insertion_order: lorebook.insertorder ?? 100,
        use_regex: lorebook.useRegex ?? false,
        constant: lorebook.alwaysActive ?? false,
        selective: lorebook.selective ?? false,
        name: lorebook.comment,
        comment: lorebook.comment,
        mode: lorebook.mode
    };
}

function splitKeys(value: string): string[] {
    return value
        .split(',')
        .map((key) => key.trim())
        .filter(Boolean);
}
