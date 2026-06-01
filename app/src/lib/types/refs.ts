/**
 * Shared Domain Reference Types — KeiAI
 *
 * Types used as JSON payloads inside DB EncryptedRecords.
 * These are strictly application/domain layer concepts, decoupled from DB schema.
 */

import type { AssetFields } from './asset';

/** Ordered reference for 1:N parent→child lists */
export interface OrderedRef {
    id: string;
    sortOrder: string; // Fractional index for ordering
    folderId?: string;
}

/** Reference with per-context state for N:M relationships */
export interface ResourceRef extends OrderedRef {
    enabled: boolean;
}

/** Folder definition (stored in parent's blob) */
export interface FolderDef {
    id: string;
    name: string;
    sortOrder: string;
    color?: string;
    parentId?: string; // Nested folders
}

export interface AssetRef extends OrderedRef, AssetFields {}

/** Grouped ref + folder config for an entity list */
export interface EntityListConfig<R extends OrderedRef = OrderedRef> {
    refs: Record<string, R>;
    folders: Record<string, FolderDef>;
}
