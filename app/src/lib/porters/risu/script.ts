import type { ScriptFields } from '$lib/services';
import { normalizeCharacterMacros } from '../utils';

export interface RisuRegexScript {
    comment?: string;
    in?: string;
    out?: string;
    type?: string;
    flag?: string;
    ableFlag?: boolean;
}

function sanitizeFlags(value: string | undefined): string {
    return (value ?? 'g')
        .replace(/<[^>]*>/g, '')
        .replace(/[^dgimsuvy]/g, '')
        .split('')
        .filter((item, index, flags) => flags.indexOf(item) === index)
        .join('');
}

export function parseRisuRegexFlag(value: string | undefined): { flag: string; order?: number } {
    let order: number | undefined;
    (value ?? 'g').replace(/<([^>]*)>/g, (_match: string, content: string) => {
        for (const item of content.split(',').map((part) => part.trim())) {
            const match = /^order\s+(-?\d+)$/i.exec(item);
            if (match) order = 100 - Number(match[1]);
        }
        return '';
    });
    const flag = sanitizeFlags(value);
    return { flag: flag || 'g', order };
}

export function formatRisuRegexFlag(flag: string | undefined, order: number): string {
    const normalized = sanitizeFlags(flag) || 'g';
    return `${normalized}<order ${100 - order}>`;
}

export function risuScriptPhase(type: string | undefined): ScriptFields['phase'] {
    if (type === 'editinput') return 'input';
    if (type === 'editprocess') return 'request';
    if (type === 'editoutput') return 'output';
    return 'display';
}

export function keiScriptPhase(phase: ScriptFields['phase']): string {
    if (phase === 'input') return 'editinput';
    if (phase === 'request') return 'editprocess';
    if (phase === 'output') return 'editoutput';
    return 'editdisplay';
}

export function risuScriptToKei(
    script: RisuRegexScript,
    index: number
): ScriptFields & { id: string } {
    const flag = parseRisuRegexFlag(script.flag);
    return {
        id: `script_${index}`,
        type: 'regex',
        name: script.comment ?? `Script ${index + 1}`,
        regex: script.in ?? '',
        replacement: normalizeCharacterMacros(script.out ?? ''),
        phase: risuScriptPhase(script.type),
        flag: flag.flag,
        advanced: script.ableFlag ?? false,
        order: flag.order ?? index,
        repeat: 1,
        enabled: script.type !== 'disabled'
    };
}

export function keiScriptToRisu(script: ScriptFields): RisuRegexScript {
    return {
        comment: script.name,
        in: script.regex,
        out: script.replacement,
        type: script.enabled ? keiScriptPhase(script.phase) : 'disabled',
        flag: formatRisuRegexFlag(script.flag, script.order),
        ableFlag: script.advanced
    };
}
