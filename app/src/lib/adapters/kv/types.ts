/** Synchronous device preferences needed during UI bootstrap. */
export interface KeyValueStore {
    get(key: string): string | null;
    set(key: string, value: string): void;
    remove(key: string): void;
    keys(prefix?: string): string[];
}

/** Durable application metadata that may require platform I/O. */
export interface AsyncKeyValueStore {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    remove(key: string): Promise<void>;
    keys(prefix?: string): Promise<string[]>;
    init(): Promise<void>;
}
