import { getActiveModuleIds } from '$lib/stores/content/merged';
import { getModule, saveModuleToggleItem, updateModule } from '$lib/stores/content/module';
import { getActivePreset, savePresetToggleItem, updatePreset } from '$lib/stores/content/preset';
import type { ToggleControlItem, ToggleOwner, ResolvedToggleSource } from '$lib/types/toggle';
import { AppError } from '$lib/types/errors';
import type { Module, Preset } from '$lib/services';

export function getToggleValue(item: ToggleControlItem): boolean | string {
    switch (item.control.type) {
        case 'checkbox':
            return item.control.value;
        case 'select':
            return item.control.selectedOptionId;
        case 'text':
            return item.control.value;
    }
}

function serializeToggleValue(item: ToggleControlItem): string {
    const control = item.control;
    switch (control.type) {
        case 'checkbox':
            return control.value ? '1' : '0';
        case 'select': {
            const optionIndex = control.options.findIndex(
                (candidate) => candidate.id === control.selectedOptionId
            );
            return optionIndex >= 0 ? String(optionIndex) : 'null';
        }
        case 'text':
            return control.value;
    }
}

async function getResolvedToggleSources(characterId?: string): Promise<ResolvedToggleSource[]> {
    const preset = getActivePreset();
    if (!preset) return [];

    const moduleIds = await getActiveModuleIds(characterId);
    const activeModules = await Promise.all([...moduleIds].map((id) => getModule(id)));
    return resolveToggleSources(
        preset,
        activeModules.filter((mod): mod is Module => mod !== null)
    );
}

export function resolveToggleSources(
    preset: Preset | null,
    activeModules: readonly Module[]
): ResolvedToggleSource[] {
    if (!preset) return [];
    return [
        {
            owner: { type: 'preset', id: preset.id },
            name: preset.name,
            panel: preset.toggles
        },
        ...activeModules.map(
            (mod) =>
                ({
                    owner: { type: 'module', id: mod.id },
                    name: mod.name,
                    panel: mod.toggles
                }) satisfies ResolvedToggleSource
        )
    ];
}

export async function setToggleValue(
    owner: ToggleOwner,
    itemId: string,
    value: unknown
): Promise<void> {
    const preset = getActivePreset();
    if (!preset) return;
    const panel =
        owner.type === 'preset'
            ? preset.id === owner.id
                ? preset.toggles
                : null
            : (await getModule(owner.id))?.toggles;
    const item = panel?.refs[itemId];
    if (!item || item.kind !== 'control') return;

    const updated = updateToggleValue(item, value);
    if (owner.type === 'preset') {
        await savePresetToggleItem(preset.id, updated);
        return;
    }

    await saveModuleToggleItem(owner.id, updated);
}

function updateToggleValue(item: ToggleControlItem, input: unknown): ToggleControlItem {
    switch (item.control.type) {
        case 'checkbox': {
            if (typeof input === 'boolean') {
                return { ...item, control: { ...item.control, value: input } };
            }
            const value = String(input ?? '')
                .trim()
                .toLowerCase();
            if (value === '1' || value === 'true') {
                return { ...item, control: { ...item.control, value: true } };
            }
            if (value === '0' || value === 'false') {
                return { ...item, control: { ...item.control, value: false } };
            }
            throw new AppError('INVALID_INPUT', `Invalid checkbox value for toggle: ${item.key}`);
        }
        case 'select': {
            const value = String(input ?? '');
            const option =
                item.control.options.find((candidate) => candidate.id === value) ??
                (/^\d+$/.test(value) ? item.control.options[Number(value)] : undefined);
            if (!option) {
                throw new AppError('INVALID_INPUT', `Invalid option for toggle: ${item.key}`);
            }
            return {
                ...item,
                control: { ...item.control, selectedOptionId: option.id }
            };
        }
        case 'text':
            return { ...item, control: { ...item.control, value: String(input ?? '') } };
    }
}

export async function getToggleMacroValue(key: string, characterId?: string): Promise<string> {
    const sources = await getResolvedToggleSources(characterId);
    for (const source of sources) {
        const item = Object.values(source.panel.refs).find(
            (candidate): candidate is ToggleControlItem =>
                candidate.kind === 'control' && candidate.key === key
        );
        if (!item) continue;
        return serializeToggleValue(item);
    }
    return 'null';
}
