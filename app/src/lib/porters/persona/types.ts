import type { PersonaFields } from '$lib/services';
import type { KeiAssetPayload } from '../types';

export interface KeiPersonaPackageV1 {
    version: 1;
    kind: 'keiai.persona';
    persona: KeiPersonaPayload;
    assets: KeiAssetPayload[];
}

export type KeiPersonaPayload = PersonaFields;
