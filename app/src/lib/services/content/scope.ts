import type { DataRecord, DataScope } from '$lib/adapters/db';
import { buffer } from './record_buffer';

export type RoutableTable = 'rooms' | 'characters' | 'personas';

export class RecordScopeService {
    static async resolve(tableName: RoutableTable, id: string): Promise<DataScope | null> {
        const record = await buffer.get<DataRecord>(tableName, id);
        if (!record || record.isDeleted) return null;
        return { scopeType: record.scopeType, scopeId: record.scopeId };
    }
}
