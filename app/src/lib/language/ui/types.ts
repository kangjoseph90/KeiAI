// Neutral UI-language types shared by the translator and message catalogs.
// Kept separate to avoid import cycles between translator.ts and messages/.

/**
 * A message that varies by cardinal plural form.
 * `other` is required and is the fallback for any missing form.
 * Form names follow `Intl.PluralRules` (zero, one, two, few, many, other).
 */
export interface PluralMessage {
    readonly other: string;
    readonly zero?: string;
    readonly one?: string;
    readonly two?: string;
    readonly few?: string;
    readonly many?: string;
}

/** A single catalog entry: a literal string, or a plural-aware set of forms. */
export type MessageValue = string | PluralMessage;
