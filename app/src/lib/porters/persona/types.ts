import type { PersonaFields } from '$lib/services';
import type { KeiAssetPayload, SerializedKeiAssetPayload } from '../types';

export interface KeiPersonaPackageV1 {
    version: 1;
    kind: 'keiai.persona';
    persona: KeiPersonaPayload;
    assets: Record<string, KeiAssetPayload>;
    avatar?: KeiAssetPayload;
}

export type KeiPersonaPayload = PersonaFields;

export interface SerializedKeiPersonaPackageV1 extends Omit<
    KeiPersonaPackageV1,
    'assets' | 'avatar'
> {
    assets: Record<string, SerializedKeiAssetPayload>;
    avatar?: SerializedKeiAssetPayload;
}
