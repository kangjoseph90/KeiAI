import type { Macro, MacroFn, TemplateContext } from './types';
import { collectCharJSInstances } from '$lib/charjs/collect';
import { invokeHandler } from '$lib/charjs/engine';
import { pluginManager } from '$lib/plugins';
import { evaluate } from './rpn';
import { getCharacter } from '$lib/stores/content/character';
import { getPersona } from '$lib/stores/content/persona';
import { getChat } from '$lib/stores/content/chat';
import { getChatVariable, setChatVariable } from '$lib/managers/chat';
import { getGlobalVariable } from '$lib/managers/preset';
import { createLogger } from '$lib/adapters/logger';

const logger = createLogger('template:macro');

export async function collectTemplateMacros(ctx: TemplateContext): Promise<Map<string, Macro>> {
    const macros = collectBuiltInMacros();

    if (ctx.chatId) {
        const charjs = await collectCharJSMacros(ctx.chatId, ctx.characterId);
        for (const [name, macro] of charjs) {
            macros.set(name, macro);
        }
    }

    const plugins = collectPluginMacros();
    for (const [name, macro] of plugins) {
        macros.set(name, macro);
    }

    return macros;
}

function collectBuiltInMacros(): Map<string, Macro> {
    const macros = new Map<string, Macro>();

    const add = (name: string, macro: Macro | MacroFn) => {
        macros.set(normalizeName(name), typeof macro === 'function' ? { run: macro } : macro);
    };
    const addAliases = (names: string[], macro: Macro | MacroFn) => {
        for (const name of names) add(name, macro);
    };

    addAliases(['br', 'newline'], () => '\n');
    addAliases(['blank', 'none'], () => '');
    addAliases(['char', 'bot', 'character'], async (_args, ctx) => {
        if (ctx.role === 'assistant' && ctx.speakerName) return ctx.speakerName;
        if (!ctx.characterId) return '';
        const character = await getCharacter(ctx.characterId);
        return character?.name ?? '';
    });
    addAliases(['description', 'chardesc'], {
        recursive: true,
        run: async (_args, ctx) => {
            if (!ctx.characterId) return '';
            const character = await getCharacter(ctx.characterId);
            return character?.description ?? '';
        }
    });
    addAliases(['characternote', 'charnote'], {
        recursive: true,
        run: async (_args, ctx) => {
            if (!ctx.characterId) return '';
            const character = await getCharacter(ctx.characterId);
            return character?.characterNote ?? '';
        }
    });
    add('user', async (_args, ctx) => {
        if (ctx.role === 'user' && ctx.speakerName) return ctx.speakerName;
        if (!ctx.personaId) return 'User';
        const persona = await getPersona(ctx.personaId);
        return persona?.name ?? 'User';
    });
    addAliases(['persona', 'userpersona'], {
        recursive: true,
        run: async (_args, ctx) => {
            if (!ctx.personaId) return '';
            const persona = await getPersona(ctx.personaId);
            return persona?.description ?? '';
        }
    });
    addAliases(['chat', 'chattitle'], async (_args, ctx) => {
        if (!ctx.chatId) return '';
        const chat = await getChat(ctx.chatId);
        return chat?.title ?? '';
    });
    add('chatnote', {
        recursive: true,
        run: async (_args, ctx) => {
            if (!ctx.chatId) return '';
            const chat = await getChat(ctx.chatId);
            return chat?.chatNote ?? '';
        }
    });
    addAliases(['chatid'], (_args, ctx) => ctx.chatId ?? '');
    addAliases(['characterid', 'charid'], (_args, ctx) => ctx.characterId ?? '');
    addAliases(['personaid', 'userid'], (_args, ctx) => ctx.personaId ?? '');
    addAliases(['speakerid'], (_args, ctx) => ctx.speakerId ?? '');
    addAliases(['speaker', 'speakername'], (_args, ctx) => ctx.speakerName ?? '');
    addAliases(['messageid', 'msgid'], (_args, ctx) => ctx.messageId ?? '');
    addAliases(['messageindex', 'msgindex'], (_args, ctx) =>
        ctx.messageIndex === undefined ? '' : String(ctx.messageIndex)
    );
    addAliases(['role'], (_args, ctx) => ctx.role ?? '');
    addAliases(['isuser'], (_args, ctx) => bool(ctx.role === 'user'));
    addAliases(['isassistant', 'isbot'], (_args, ctx) => bool(ctx.role === 'assistant'));
    addAliases(['isdisplay'], (_args, ctx) => bool(ctx.display === true));
    addAliases(['isdryrun'], (_args, ctx) => bool(ctx.dryRun === true));
    add('time', () => formatLocalDate(new Date(), 'HH:mm:ss'));
    add('isotime', () => new Date().toISOString());
    add('isodate', () => new Date().toISOString().slice(0, 10));
    add('unixtime', () => String(Math.floor(Date.now() / 1000)));
    addAliases(['date', 'datetimeformat'], (args) =>
        formatLocalDate(new Date(), args.join(':') || 'YYYY-MM-DD')
    );
    addAliases(['?', 'calc'], ([expression]) => {
        try {
            return String(evaluate(expression ?? '0'));
        } catch {
            return 'ERROR';
        }
    });
    add('round', ([value]) => String(Math.round(toNumber(value))));
    add('floor', ([value]) => String(Math.floor(toNumber(value))));
    add('ceil', ([value]) => String(Math.ceil(toNumber(value))));
    add('abs', ([value]) => String(Math.abs(toNumber(value))));
    add('pow', ([base, exponent]) => String(toNumber(base) ** toNumber(exponent)));
    addAliases(['remainder', 'remaind'], ([a, b]) => String(toNumber(a) % toNumber(b)));
    add('equal', ([a, b]) => bool(a === b));
    add('notequal', ([a, b]) => bool(a !== b));
    add('greater', ([a, b]) => bool(toNumber(a) > toNumber(b)));
    add('less', ([a, b]) => bool(toNumber(a) < toNumber(b)));
    add('greaterequal', ([a, b]) => bool(toNumber(a) >= toNumber(b)));
    add('lessequal', ([a, b]) => bool(toNumber(a) <= toNumber(b)));
    add('and', ([a, b]) => bool(isTruthy(a) && isTruthy(b)));
    add('or', ([a, b]) => bool(isTruthy(a) || isTruthy(b)));
    add('not', ([value]) => bool(!isTruthy(value)));
    add('length', ([value]) => String((value ?? '').length));
    add('trim', ([value]) => value?.trim() ?? '');
    add('lower', ([value]) => value?.toLowerCase() ?? '');
    add('upper', ([value]) => value?.toUpperCase() ?? '');
    add('capitalize', ([value]) => {
        const text = value ?? '';
        return text ? text[0].toUpperCase() + text.slice(1) : '';
    });
    add('replace', ([value, search, replacement]) =>
        search === undefined ? (value ?? '') : (value ?? '').split(search).join(replacement ?? '')
    );
    add('contains', ([value, search]) => bool((value ?? '').includes(search ?? '')));
    add('startswith', ([value, search]) => bool((value ?? '').startsWith(search ?? '')));
    add('endswith', ([value, search]) => bool((value ?? '').endsWith(search ?? '')));
    add('getvar', async ([key], ctx) => {
        if (!ctx.chatId || !key) return '';
        return (await getChatVariable(ctx.chatId, key)) ?? '';
    });
    add('getglobalvar', async ([key]) => {
        if (!key) return '';
        return (await getGlobalVariable(key)) ?? 'null';
    });
    add('setvar', async ([key, value], ctx) => {
        if (!ctx.chatId || !key || ctx.dryRun) return '';
        await setChatVariable(ctx.chatId, key, value ?? '');
        return '';
    });
    add('addvar', async ([key, amount], ctx) => {
        if (!ctx.chatId || !key || ctx.dryRun) return '';
        const current = toNumber((await getChatVariable(ctx.chatId, key)) ?? '0');
        await setChatVariable(ctx.chatId, key, String(current + toNumber(amount)));
        return '';
    });
    addAliases(['img', 'image'], ([assetId], ctx) => {
        if (!assetId) return '';
        if (!ctx.display) return `{{img::${assetId}}}`;
        return [
            '<img',
            ` data-keiai-asset-id="${escapeHtmlAttribute(assetId)}"`,
            ' alt=""',
            ' loading="lazy"',
            ' decoding="async"',
            ' />'
        ].join('');
    });

    return macros;
}

async function collectCharJSMacros(
    chatId: string,
    characterId?: string
): Promise<Map<string, Macro>> {
    const macros = new Map<string, Macro>();
    const instances = await collectCharJSInstances(chatId, 'template', 'macro', characterId);
    for (const instance of instances) {
        for (const [name, entry] of instance.macroHandlers) {
            macros.set(normalizeName(name), {
                recursive: entry.recursive,
                run: async (args, macroCtx) => {
                    const result = await invokeHandler(instance, entry.fnHandle, args, macroCtx);
                    return typeof result === 'string' ? result : String(result ?? '');
                }
            });
        }
    }

    return macros;
}

function collectPluginMacros(): Map<string, Macro> {
    const macros = new Map<string, Macro>();

    for (const instance of pluginManager.getInstances()) {
        for (const [name, entry] of instance.macroHandlers) {
            macros.set(normalizeName(name), {
                recursive: entry.recursive,
                run: async (args, macroCtx) => {
                    try {
                        const result = await instance.broker.invoke(entry.fnId, [args, macroCtx]);
                        return typeof result === 'string' ? result : String(result ?? '');
                    } catch (error) {
                        logger.error(`Error executing plugin macro [${name}]:`, error);
                        return '';
                    }
                }
            });
        }
    }

    return macros;
}

function normalizeName(name: string): string {
    return name.trim().toLowerCase();
}

function toNumber(value: string | undefined): number {
    const number = Number(value ?? 0);
    return Number.isFinite(number) ? number : 0;
}

function bool(value: boolean): string {
    return value ? '1' : '0';
}

function escapeHtmlAttribute(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('"', '&quot;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
}

function isTruthy(value: string | undefined): boolean {
    const normalized = (value ?? '').trim().toLowerCase();
    return (
        normalized !== '' && normalized !== '0' && normalized !== 'false' && normalized !== 'null'
    );
}

function formatLocalDate(date: Date, format: string): string {
    const parts: Record<string, string> = {
        YYYY: String(date.getFullYear()),
        MM: String(date.getMonth() + 1).padStart(2, '0'),
        DD: String(date.getDate()).padStart(2, '0'),
        HH: String(date.getHours()).padStart(2, '0'),
        mm: String(date.getMinutes()).padStart(2, '0'),
        ss: String(date.getSeconds()).padStart(2, '0')
    };

    return Object.entries(parts).reduce(
        (result, [token, value]) => result.replaceAll(token, value),
        format
    );
}
