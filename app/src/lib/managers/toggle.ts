import { getActiveModuleIds } from '$lib/stores/content/merged';
import { getModule, updateModule } from '$lib/stores/content/module';
import { getActivePreset, updatePresetContent } from '$lib/stores/content/preset';
import type {
    ToggleControlItem,
    ToggleOwner,
    ToggleValue,
    ResolvedToggleSource
} from '$lib/types/toggle';
import { AppError } from '$lib/types/errors';
import type { Module, Preset } from '$lib/services';

export function getToggleValue(item: ToggleControlItem): ToggleValue {
    switch (item.control.type) {
        case 'checkbox':
            return item.control.value;
        case 'select':
            return item.control.selectedOptionId;
        case 'text':
            return item.control.value;
    }
}

export function normalizeToggleValue(item: ToggleControlItem, value: unknown): ToggleValue {
    const control = item.control;
    switch (control.type) {
        case 'checkbox': {
            if (typeof value === 'boolean') return value;
            const normalized = String(value ?? '')
                .trim()
                .toLowerCase();
            if (normalized === '1' || normalized === 'true') return true;
            if (normalized === '0' || normalized === 'false') return false;
            throw new AppError('INVALID_INPUT', `Invalid checkbox value for toggle: ${item.key}`);
        }
        case 'select': {
            const raw = String(value ?? '');
            const optionById = control.options.find((candidate) => candidate.id === raw);
            const optionIndex = /^\d+$/.test(raw) ? Number(raw) : -1;
            const option = optionById ?? control.options[optionIndex];
            if (!option) {
                throw new AppError('INVALID_INPUT', `Invalid option for toggle: ${item.key}`);
            }
            return option.id;
        }
        case 'text':
            return String(value ?? '');
    }
}

export function serializeToggleValue(item: ToggleControlItem): string {
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

export async function getResolvedToggleSources(
    characterId?: string
): Promise<ResolvedToggleSource[]> {
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

    const updated = withToggleValue(item, normalizeToggleValue(item, value));
    if (owner.type === 'preset') {
        await updatePresetContent(preset.id, {
            toggles: { refs: { [item.id]: updated } }
        });
        return;
    }

    await updateModule(owner.id, {
        toggles: { refs: { [item.id]: updated } }
    });
}

function withToggleValue(item: ToggleControlItem, value: ToggleValue): ToggleControlItem {
    switch (item.control.type) {
        case 'checkbox':
            return { ...item, control: { ...item.control, value: value === true } };
        case 'select':
            return { ...item, control: { ...item.control, selectedOptionId: String(value) } };
        case 'text':
            return { ...item, control: { ...item.control, value: String(value) } };
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
