import type { ModuleFields } from '$lib/services';
import type { KeiAssetPayload } from '../types';

export interface KeiModulePackageV1 {
    version: 1;
    kind: 'keiai.module';
    module: KeiModulePayload;
    assets: Record<string, KeiAssetPayload>;
}

export type KeiModulePayload = ModuleFields;
