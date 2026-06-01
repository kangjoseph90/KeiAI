import type { CharacterFields, CharJSFields, LorebookFields, ScriptFields } from '$lib/services';
import type { KeiAssetPayload, SerializedKeiAssetPayload } from '../types';

export interface KeiCharacterPackageV1 {
    version: 1;
    kind: 'keiai.character';
    character: KeiCharacterPayload;
    lorebooks: KeiLorebookPayload[];
    scripts: KeiScriptPayload[];
    charjs: KeiCharJSPayload[];
    assets: Record<string, KeiAssetPayload>;
    avatar?: KeiAssetPayload;
}

export type KeiCharacterPayload = Omit<CharacterFields, 'modules'>;
export type KeiLorebookPayload = LorebookFields & { id: string };
export type KeiScriptPayload = ScriptFields & { id: string };
export type KeiCharJSPayload = CharJSFields & { id: string };

export interface SerializedKeiCharacterPackageV1 extends Omit<
    KeiCharacterPackageV1,
    'assets' | 'avatar'
> {
    assets: Record<string, SerializedKeiAssetPayload>;
    avatar?: SerializedKeiAssetPayload;
}
