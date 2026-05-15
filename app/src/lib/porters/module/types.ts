import type { CharJSFields, LorebookFields, ModuleFields, ScriptFields } from '$lib/services';
import type { KeiAssetPayload } from '../types';

export interface KeiModulePackageV1 {
    version: 1;
    kind: 'keiai.module';
    module: KeiModulePayload;
    lorebooks: KeiLorebookPayload[];
    scripts: KeiScriptPayload[];
    charjs: KeiCharJSPayload[];
    assets: KeiAssetPayload[];
}

export type KeiModulePayload = ModuleFields;
export type KeiLorebookPayload = LorebookFields & { id: string };
export type KeiScriptPayload = ScriptFields & { id: string };
export type KeiCharJSPayload = CharJSFields & { id: string };
