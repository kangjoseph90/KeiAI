import { englishMessages, type MessageKey } from './en';
import { koreanMessages } from './ko';
import type { UiLocale } from '../locales';
import type { MessageValue } from '../types';

type UiMessageCatalog = Record<MessageKey, MessageValue>;

export const UI_MESSAGES = {
    en: englishMessages,
    ko: koreanMessages
} satisfies Record<UiLocale, UiMessageCatalog>;

export type { MessageKey, MessageTemplate } from './en';
