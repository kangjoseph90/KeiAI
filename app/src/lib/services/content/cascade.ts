/**
 * Shared Cascade Delete Helper
 *
 * Complete parent-child FK mapping and recursive cascade logic.
 * Used by both content services (UI actions) and sync engine (remote deletions)
 * to ensure consistent cascade behavior.
 */

import {
    localDB,
    type TableName,
    type DataRecord,
    type DatabaseWriteOptions
} from '$lib/adapters/db';

import { AssetService, type AssetOwner } from '../asset';
import { createLogger } from '$lib/adapters/logger';

const logger = createLogger('content:cascade');

// ─── Parent-Child Relationship Mapping ──────────────────────────────────

export interface ParentChildRelation {
    parent: TableName;
    child: TableName;
    fk: string;
    recurse?: boolean;
}

/**
 * Complete parent-child FK relationships for cascade soft-delete.
 * Shared by content services (UI actions) and sync engine (remote deletions).
 */
export const PARENT_CHILD: readonly ParentChildRelation[] = [
    // rooms → chats
    { parent: 'rooms', child: 'chats', fk: 'roomId' },
    // chats → owned resources + messages + chat-level tables
    { parent: 'chats', child: 'lorebooks', fk: 'ownerId' },
    { parent: 'chats', child: 'scripts', fk: 'ownerId' },
    { parent: 'chats', child: 'messages', fk: 'chatId', recurse: false },
    { parent: 'chats', child: 'tool_calls', fk: 'chatId' },
    { parent: 'chats', child: 'translations', fk: 'chatId' },
    // characters → owned resources
    { parent: 'characters', child: 'lorebooks', fk: 'ownerId' },
    { parent: 'characters', child: 'scripts', fk: 'ownerId' },
    { parent: 'characters', child: 'charjs', fk: 'ownerId' },
    // modules → owned resources
    { parent: 'modules', child: 'lorebooks', fk: 'ownerId' },
    { parent: 'modules', child: 'scripts', fk: 'ownerId' },
    { parent: 'modules', child: 'charjs', fk: 'ownerId' },
    // presets → scripts
    { parent: 'presets', child: 'scripts', fk: 'ownerId' },
    // messages → message-level tables
    { parent: 'messages', child: 'tool_calls', fk: 'messageId' },
    { parent: 'messages', child: 'translations', fk: 'messageId' }
] as const;

// ─── Types ──────────────────────────────────────────────────────────────

export interface CascadeResult {
    /** Map of table name to array of IDs that were soft-deleted */
    deleted: Partial<Record<TableName, string[]>>;
    /** Locators for all deleted records that might own assets */
    assetOwners: AssetOwner[];
}

// ─── Helper Functions ───────────────────────────────────────────────────

/**
 * Get all descendant tables involved in a cascade from a given parent table.
 * Useful for determining which tables need their buffers flushed
 * or be included in a transaction.
 */
export function getCascadeTables(parentTable: TableName): TableName[] {
    const tables = new Set<TableName>();
    collectCascadeTables(parentTable, tables);
    return [...tables];
}

function collectCascadeTables(table: TableName, acc: Set<TableName>): void {
    for (const rel of PARENT_CHILD) {
        if (rel.parent === table && !acc.has(rel.child)) {
            acc.add(rel.child);
            collectCascadeTables(rel.child, acc);
        }
    }
}

/**
 * Recursively soft-delete all live children of a given parent.
 *
 * This only deletes children, NOT the parent record itself.
 * The caller is responsible for deleting the parent.
 *
 * @param parentTable - The table of the parent being deleted
 * @param parentId - The ID of the parent being deleted
 * @param options - Database write options (e.g., origin)
 * @returns CascadeResult with info about what was deleted
 */
export async function cascadeDeleteChildren(
    parentTable: TableName,
    parentId: string,
    options?: DatabaseWriteOptions
): Promise<CascadeResult> {
    const result: CascadeResult = { deleted: {}, assetOwners: [] };
    await cascadeDeleteRecursive(parentTable, parentId, options, result);
    return result;
}

/**
 * Cleanup helper for the results of a cascade delete.
 * Should be called OUTSIDE of a database transaction.
 */
export async function cleanupCascadeAssets(
    result: CascadeResult | null | undefined
): Promise<void> {
    if (!result?.assetOwners || result.assetOwners.length === 0) return;

    await Promise.all(
        result.assetOwners.map(async (owner) => {
            try {
                await AssetService.deleteOwnerAssets(owner);
            } catch (err) {
                logger.error(
                    `Failed to cleanup cascade assets for ${owner.ownerTable}:${owner.ownerId}`,
                    err
                );
            }
        })
    );
}

async function cascadeDeleteRecursive(
    parentTable: TableName,
    parentId: string,
    options: DatabaseWriteOptions | undefined,
    result: CascadeResult
): Promise<void> {
    const relations = PARENT_CHILD.filter((pc) => pc.parent === parentTable);
    if (relations.length === 0) return;

    const nextLevel: Array<{ table: TableName; id: string }> = [];

    for (const rel of relations) {
        const { child, fk } = rel;
        const children = await localDB.getByIndex<DataRecord>(child, fk, parentId, Infinity);

        if (children.length === 0) continue;

        await localDB.softDeleteByIndex(child, fk, parentId, options);

        const existing = result.deleted[child] ?? [];
        result.deleted[child] = [...existing, ...children.map((r) => r.id)];

        for (const r of children) {
            result.assetOwners.push({
                scopeType: r.scopeType,
                scopeId: r.scopeId,
                ownerTable: child,
                ownerId: r.id
            });

            if (rel.recurse !== false) {
                nextLevel.push({ table: child, id: r.id });
            }
        }
    }

    for (const { table, id } of nextLevel) {
        await cascadeDeleteRecursive(table, id, options, result);
    }
}
