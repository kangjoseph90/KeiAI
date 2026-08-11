import type { PresetFields } from '$lib/services';

export interface KeiPresetPackageV1 {
    version: 1;
    kind: 'keiai.preset';
    preset: PresetFields;
}
