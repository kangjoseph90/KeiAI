import { AppError } from '$lib/types/errors';
import { MessageService, type Message } from './message';

// ─── Domain Types ──────────────────────────────────────────────────────

export interface PagedMessagesOptions {
    pageSize?: number;
}

export interface IndexedMessage {
    message: Message;
    index: number;
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
    private readonly pagedLength: number;
    private readonly lastMessageId: string | null;
    private lastMessage: Message | null;
    private lastMessageDirty = false;

    private constructor(
        chatId: string,
        pageSize: number,
        pagedLength: number,
        beforeSortOrder: string,
        lastMessage?: Message
    ) {
        this.chatId = chatId;
        this.pageSize = pageSize;
        this.pagedLength = pagedLength;
        this.length = pagedLength + (lastMessage ? 1 : 0);
        this.beforeSortOrder = beforeSortOrder;
        this.lastMessageId = lastMessage?.id ?? null;
        this.lastMessage = lastMessage ?? null;
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

    static async createThrough(
        lastMessage: Message,
        options: PagedMessagesOptions = {}
    ): Promise<PagedMessages> {
        const pageSize = normalizePageSize(options.pageSize ?? DEFAULT_PAGE_SIZE);
        const beforeLength = await MessageService.countByChatBefore(
            lastMessage.chatId,
            lastMessage.sortOrder
        );
        return new PagedMessages(
            lastMessage.chatId,
            pageSize,
            beforeLength,
            lastMessage.sortOrder,
            lastMessage
        );
    }

    async at(index: number): Promise<IndexedMessage | null> {
        const resolved = normalizeIndex(index, this.length);
        if (resolved === null) return null;

        if (this.lastMessageId && resolved === this.pagedLength) {
            const message = await this.loadLastMessage();
            return message ? { message, index: resolved } : null;
        }

        const pageIndex = Math.floor(resolved / this.pageSize);
        const pageOffset = resolved % this.pageSize;
        const page = await this.loadPage(pageIndex);
        const message = page[pageOffset] ?? null;

        return message ? { message, index: resolved } : null;
    }

    async slice(start?: number, end?: number): Promise<IndexedMessage[]> {
        const resolvedStart = normalizeSliceBound(start, this.length, 0);
        const resolvedEnd = normalizeSliceBound(end, this.length, this.length);
        if (resolvedStart >= resolvedEnd) return [];

        const beforeEnd = Math.min(resolvedEnd, this.pagedLength);
        const messages =
            resolvedStart < beforeEnd ? await this.sliceBefore(resolvedStart, beforeEnd) : [];

        if (
            this.lastMessageId &&
            resolvedStart <= this.pagedLength &&
            this.pagedLength < resolvedEnd
        ) {
            const message = await this.loadLastMessage();
            if (message) messages.push({ message, index: this.pagedLength });
        }

        return messages;
    }

    async toArray(): Promise<IndexedMessage[]> {
        return this.slice();
    }

    invalidate(index: number): void {
        const resolved = normalizeIndex(index, this.length);
        if (resolved === null) return;

        if (this.lastMessageId && resolved === this.pagedLength) {
            this.lastMessage = null;
            this.lastMessageDirty = true;
            return;
        }

        if (resolved >= this.pagedLength) return;
        this.pages.delete(Math.floor(resolved / this.pageSize));
    }

    clear(): void {
        this.pages.clear();
        if (this.lastMessageId) {
            this.lastMessage = null;
            this.lastMessageDirty = true;
        }
    }

    private async sliceBefore(start: number, end: number): Promise<IndexedMessage[]> {
        const firstPage = Math.floor(start / this.pageSize);
        const lastPage = Math.floor((end - 1) / this.pageSize);
        const pagePromises: Promise<Message[]>[] = [];

        for (let pageIndex = firstPage; pageIndex <= lastPage; pageIndex += 1) {
            pagePromises.push(this.loadPage(pageIndex));
        }

        const pages = await Promise.all(pagePromises);
        const messages = pages.flat();
        const localStart = start - firstPage * this.pageSize;
        const localEnd = localStart + (end - start);
        const slicedMessages = messages.slice(localStart, localEnd);

        return slicedMessages.map((message, offset) => ({
            message,
            index: start + offset
        }));
    }

    private loadPage(pageIndex: number): Promise<Message[]> {
        const cached = this.pages.get(pageIndex);
        if (cached) return cached;

        const offset = pageIndex * this.pageSize;
        const limit = Math.min(this.pageSize, this.pagedLength - offset);
        const backwardOffset = this.pagedLength - offset - limit;
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

    private async loadLastMessage(): Promise<Message | null> {
        if (!this.lastMessageId) return null;
        if (!this.lastMessageDirty) return this.lastMessage;

        const message = await MessageService.get(this.lastMessageId);
        this.lastMessage = message?.chatId === this.chatId ? message : null;
        this.lastMessageDirty = false;
        return this.lastMessage;
    }
}
