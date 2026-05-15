import type { PresetFields, ScriptFields } from '$lib/services';

export interface KeiPresetPackageV1 {
    version: 1;
    kind: 'keiai.preset';
    preset: KeiPresetPayload;
    scripts: KeiScriptPayload[];
}

export type KeiPresetPayload = PresetFields;
export type KeiScriptPayload = ScriptFields & { id: string };
