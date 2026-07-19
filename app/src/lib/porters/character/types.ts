import type { CharacterFields } from '$lib/services';
import type { KeiAssetPayload, SerializedKeiAssetPayload } from '../types';

export interface KeiCharacterPackageV1 {
    version: 1;
    kind: 'keiai.character';
    character: KeiCharacterPayload;
    assets: Record<string, KeiAssetPayload>;
    avatar?: KeiAssetPayload;
}

export type KeiCharacterPayload = Omit<CharacterFields, 'modules'>;

export interface SerializedKeiCharacterPackageV1 extends Omit<
    KeiCharacterPackageV1,
    'assets' | 'avatar'
> {
    assets: Record<string, SerializedKeiAssetPayload>;
    avatar?: SerializedKeiAssetPayload;
}
