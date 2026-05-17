import { parseCharacterCardV3 } from './ccv3';
import { cardToKeiPackage } from './risu';
import type { KeiCharacterPackageV1 } from './types';

const TEXT_DECODER = new TextDecoder();

export type CharacterJsonInput = File | Uint8Array | string;

export async function readCharacterJson(input: CharacterJsonInput): Promise<KeiCharacterPackageV1> {
    const text = await readText(input);
    const card = parseCharacterCardV3(JSON.parse(text) as unknown);
    return cardToKeiPackage(card);
}

async function readText(input: CharacterJsonInput): Promise<string> {
    if (typeof input === 'string') return input;
    if (input instanceof Uint8Array) return TEXT_DECODER.decode(input);
    return await input.text();
}
