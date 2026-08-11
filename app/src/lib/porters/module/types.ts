import type { ModuleFields } from '$lib/services';
import type { KeiAssetPayload } from '../types';

export interface KeiModulePackageV1 {
    version: 1;
    kind: 'keiai.module';
    module: ModuleFields;
    assets: Record<string, KeiAssetPayload>;
}
