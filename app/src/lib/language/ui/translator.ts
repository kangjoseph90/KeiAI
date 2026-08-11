import { getLanguageDirection } from '../registry';
import { UI_MESSAGES, type MessageKey, type MessageTemplate } from './messages';
import type { UiLocale } from './locales';
import type { MessageValue, PluralMessage } from './types';

export type InterpolationValue = string | number;

const LATIN = 'abcdefghijklmnopqrstuvwxyz';
const PSEUDO_LATIN = 'àƀçďëƒğħïĵķľɱñôþզŕšţüṽŵẋÿž';
const PSEUDO_CHARACTERS = new Map(
    [...LATIN].map((character, index) => [character, PSEUDO_LATIN[index]])
);
const PRESERVED_TOKEN_PATTERN = /\{:[^{}]+\}|\{\{[^{}]+\}\}/g;

type PlaceholderNames<Message extends string> =
    Message extends `${string}{:${infer Name}}${infer Rest}`
        ? Name extends ''
            ? PlaceholderNames<Rest>
            : Name | PlaceholderNames<Rest>
        : never;

type PluralPlaceholders<P extends PluralMessage> =
    | PlaceholderNames<P['other']>
    | (P['zero'] extends string ? PlaceholderNames<P['zero']> : never)
    | (P['one'] extends string ? PlaceholderNames<P['one']> : never)
    | (P['two'] extends string ? PlaceholderNames<P['two']> : never)
    | (P['few'] extends string ? PlaceholderNames<P['few']> : never)
    | (P['many'] extends string ? PlaceholderNames<P['many']> : never);

export type MessageParams<Key extends MessageKey> =
    MessageTemplate<Key> extends PluralMessage
        ? Readonly<Record<'count', number>> &
              Readonly<
                  Partial<Record<PluralPlaceholders<MessageTemplate<Key>>, InterpolationValue>>
              >
        : MessageTemplate<Key> extends string
          ? [PlaceholderNames<MessageTemplate<Key>>] extends [never]
              ? never
              : Readonly<Record<PlaceholderNames<MessageTemplate<Key>>, InterpolationValue>>
          : never;

type MessageKeysWithParams = {
    [Key in MessageKey]: [MessageParams<Key>] extends [never] ? never : Key;
}[MessageKey];

type MessageKeysWithoutParams = Exclude<MessageKey, MessageKeysWithParams>;

export interface Translator {
    <Key extends MessageKeysWithoutParams>(key: Key): string;
    <Key extends MessageKeysWithParams>(key: Key, params: MessageParams<Key>): string;
}

export function interpolateMessage(
    message: string,
    params: Readonly<Record<string, InterpolationValue>>
): string {
    return message.replace(/\{:([^{}]+)\}/g, (placeholder, name: string) => {
        return Object.hasOwn(params, name) ? String(params[name]) : placeholder;
    });
}

function pseudoLocalizeMessage(message: string): string {
    let result = '';
    let letterCount = 0;
    let cursor = 0;

    for (const match of message.matchAll(PRESERVED_TOKEN_PATTERN)) {
        const index = match.index;
        const segment = message.slice(cursor, index);
        result += pseudoLocalizeSegment(segment);
        letterCount += (segment.match(/[A-Za-z]/g) ?? []).length;
        result += match[0];
        cursor = index + match[0].length;
    }

    const remainder = message.slice(cursor);
    result += pseudoLocalizeSegment(remainder);
    letterCount += (remainder.match(/[A-Za-z]/g) ?? []).length;
    return `［${result}${'·'.repeat(Math.ceil(letterCount * 0.3))}］`;
}

function pseudoLocalizeSegment(segment: string): string {
    return segment.replace(/[A-Za-z]/g, (character) => {
        const replacement = PSEUDO_CHARACTERS.get(character.toLowerCase()) ?? character;
        return character === character.toUpperCase() ? replacement.toUpperCase() : replacement;
    });
}

const pluralRulesCache = new Map<string, Intl.PluralRules>();

function getPluralRules(locale: string): Intl.PluralRules {
    let rules = pluralRulesCache.get(locale);
    if (!rules) {
        rules = new Intl.PluralRules(locale);
        pluralRulesCache.set(locale, rules);
    }
    return rules;
}

function resolveMessageValue(
    locale: UiLocale,
    value: MessageValue,
    params: Readonly<Record<string, InterpolationValue>> | undefined
): string {
    if (typeof value === 'string') return value;
    const count = params && typeof params.count === 'number' ? params.count : 0;
    const form = getPluralRules(locale).select(count);
    const plural: PluralMessage = value;
    return plural[form] ?? plural.other;
}

export function createTranslator(locale: UiLocale, options: { pseudo?: boolean } = {}): Translator {
    return ((key: MessageKey, params?: Readonly<Record<string, InterpolationValue>>) => {
        const value = UI_MESSAGES[locale][key] ?? UI_MESSAGES.en[key];
        const message = resolveMessageValue(locale, value, params);
        const displayMessage = options.pseudo ? pseudoLocalizeMessage(message) : message;
        return params ? interpolateMessage(displayMessage, params) : displayMessage;
    }) as Translator;
}

export function getUiLocaleDirection(locale: UiLocale): 'ltr' | 'rtl' {
    return getLanguageDirection(locale);
}
