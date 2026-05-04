import { AppError } from '$lib/types/errors';
import { MessageService, type Message } from './message';

// ─── Domain Types ──────────────────────────────────────────────────────

export interface PagedMessagesOptions {
    pageSize?: number;
}

// ─── Defaults ─────────────────────────────────────────────────────────

const DEFAULT_PAGE_SIZE = 32;

// ─── Helpers ──────────────────────────────────────────────────────────

function normalizePageSize(pageSize: number): number {
    const normalized = Math.trunc(pageSize);
    if (!Number.isFinite(normalized) || normalized < 1) {
        throw new AppError('INVALID_INPUT', 'Page size must be a positive integer');
    }
    return normalized;
}

function toArrayInteger(value: number): number {
    if (Number.isNaN(value)) return 0;
    return Math.trunc(value);
}

function normalizeIndex(index: number, length: number): number | null {
    const normalized = toArrayInteger(index);
    if (!Number.isFinite(normalized)) return null;
    const resolved = normalized < 0 ? length + normalized : normalized;
    if (resolved < 0 || resolved >= length) return null;
    return resolved;
}

function normalizeSliceBound(value: number | undefined, length: number, fallback: number): number {
    if (value === undefined) return fallback;
    const normalized = toArrayInteger(value);
    if (normalized === Infinity) return length;
    if (normalized === -Infinity) return 0;
    const resolved = normalized < 0 ? length + normalized : normalized;
    if (resolved < 0) return 0;
    if (resolved > length) return length;
    return resolved;
}

// ─── Service Read Model ────────────────────────────────────────────────

/**
 * Readonly transient virtual array for all messages in a chat.
 *
 * Pages are loaded on demand through MessageService and cached for this instance only.
 * Indexes are ordered oldest-to-newest, matching MessageService.getMessagesAfter().
 * The view is bounded before a target message so prompt history cannot drift when
 * newer messages are appended while the prompt is being built.
 */
export class PagedMessages {
    readonly chatId: string;
    readonly pageSize: number;
    readonly length: number;
    readonly beforeSortOrder: string;

    private readonly pages = new Map<number, Promise<Message[]>>();

    private constructor(chatId: string, pageSize: number, length: number, beforeSortOrder: string) {
        this.chatId = chatId;
        this.pageSize = pageSize;
        this.length = length;
        this.beforeSortOrder = beforeSortOrder;
    }

    static async createBefore(
        chatId: string,
        beforeSortOrder: string,
        options: PagedMessagesOptions = {}
    ): Promise<PagedMessages> {
        const pageSize = normalizePageSize(options.pageSize ?? DEFAULT_PAGE_SIZE);
        const length = await MessageService.countByChatBefore(chatId, beforeSortOrder);
        return new PagedMessages(chatId, pageSize, length, beforeSortOrder);
    }

    async at(index: number): Promise<Message | null> {
        const resolved = normalizeIndex(index, this.length);
        if (resolved === null) return null;

        const pageIndex = Math.floor(resolved / this.pageSize);
        const pageOffset = resolved % this.pageSize;
        const page = await this.loadPage(pageIndex);
        return page[pageOffset] ?? null;
    }

    async slice(start?: number, end?: number): Promise<Message[]> {
        const resolvedStart = normalizeSliceBound(start, this.length, 0);
        const resolvedEnd = normalizeSliceBound(end, this.length, this.length);
        if (resolvedStart >= resolvedEnd) return [];

        const firstPage = Math.floor(resolvedStart / this.pageSize);
        const lastPage = Math.floor((resolvedEnd - 1) / this.pageSize);
        const pagePromises: Promise<Message[]>[] = [];

        for (let pageIndex = firstPage; pageIndex <= lastPage; pageIndex += 1) {
            pagePromises.push(this.loadPage(pageIndex));
        }

        const pages = await Promise.all(pagePromises);
        const messages = pages.flat();
        const localStart = resolvedStart - firstPage * this.pageSize;
        const localEnd = localStart + (resolvedEnd - resolvedStart);
        return messages.slice(localStart, localEnd);
    }

    async toArray(): Promise<Message[]> {
        return this.slice();
    }

    clear(): void {
        this.pages.clear();
    }

    private loadPage(pageIndex: number): Promise<Message[]> {
        const cached = this.pages.get(pageIndex);
        if (cached) return cached;

        const offset = pageIndex * this.pageSize;
        const limit = Math.min(this.pageSize, this.length - offset);
        const backwardOffset = this.length - offset - limit;
        const page =
            offset <= backwardOffset
                ? MessageService.getMessagesAfter(this.chatId, '', limit, offset)
                : MessageService.getMessagesBefore(
                      this.chatId,
                      this.beforeSortOrder,
                      limit,
                      backwardOffset
                  );
        this.pages.set(pageIndex, page);
        return page;
    }
}
