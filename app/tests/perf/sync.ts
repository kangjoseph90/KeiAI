import { performance } from 'perf_hooks';

// Mock types to match the code we are optimizing
type BaseRecord = { id: string; updatedAt?: number; [key: string]: unknown };

class MockDB {
	private records: Map<string, BaseRecord> = new Map();

	constructor(count: number) {
		for (let i = 0; i < count; i++) {
			this.records.set(`id_${i}`, { id: `id_${i}`, updatedAt: Date.now() - 10000 });
		}
	}

	async getRecord(tableName: string, id: string): Promise<BaseRecord | undefined> {
		// Simulate network / DB latency
		await new Promise((resolve) => setTimeout(resolve, 1));
		return this.records.get(id);
	}

	async putRecord(tableName: string, record: BaseRecord, options?: unknown): Promise<void> {
		await new Promise((resolve) => setTimeout(resolve, 1));
		this.records.set(record.id, record);
	}
}

async function runBenchmark() {
	console.log('--- Benchmarking Data Sync pullTable N+1 Query ---');
	const ITEM_COUNT = 200; // Matches PAGE_SIZE in sync/data.ts

	const localDB = new MockDB(ITEM_COUNT);

	// Generate mock server records
	const result = {
		items: Array.from({ length: ITEM_COUNT }).map((_, i) => ({
			id: `id_${i}`,
			updatedAt: Date.now()
		}))
	};

	const pbToLocalRecord = (record: unknown) => record as BaseRecord;

	// --- 1. Sequential Approach (Baseline) ---
	let nextCursorSeq = 0;
	const offlineWritesSeq: BaseRecord[] = [];

	const startSeq = performance.now();

	for (const serverRecord of result.items) {
		const remote = pbToLocalRecord(serverRecord as unknown as Record<string, unknown>);
		const local = await localDB.getRecord('mockTable', remote.id);
		const remoteAt = remote.updatedAt ?? 0;
		const localAt = local?.updatedAt ?? 0;

		if (!local || remoteAt > localAt) {
			await localDB.putRecord('mockTable', remote, { origin: 'sync' });
			nextCursorSeq = Math.max(nextCursorSeq, remoteAt);
		} else if (remoteAt < localAt) {
			offlineWritesSeq.push(local!);
			nextCursorSeq = Math.max(nextCursorSeq, localAt);
		} else {
			nextCursorSeq = Math.max(nextCursorSeq, remoteAt);
		}
	}

	const endSeq = performance.now();
	const seqTime = endSeq - startSeq;
	console.log(`[Baseline] Sequential N+1 queries took: ${seqTime.toFixed(2)}ms`);

	// --- 2. Parallel Approach (Optimized) ---
	// Reset local DB state for a fair test
	const localDB2 = new MockDB(ITEM_COUNT);
	let nextCursorPar = 0;
	const offlineWritesPar: BaseRecord[] = [];

	const startPar = performance.now();

	// Fetch all locals in parallel first
	const remotes = result.items.map((item) =>
		pbToLocalRecord(item as unknown as Record<string, unknown>)
	);

	// Simulate the parallel getRecord calls
	const localPromises = remotes.map((remote) => localDB2.getRecord('mockTable', remote.id));
	const locals = await Promise.all(localPromises);

	// Process them
	const putPromises: Promise<void>[] = [];
	for (let i = 0; i < remotes.length; i++) {
		const remote = remotes[i];
		const local = locals[i];
		const remoteAt = remote.updatedAt ?? 0;
		const localAt = local?.updatedAt ?? 0;

		if (!local || remoteAt > localAt) {
			putPromises.push(localDB2.putRecord('mockTable', remote, { origin: 'sync' }));
			nextCursorPar = Math.max(nextCursorPar, remoteAt);
		} else if (remoteAt < localAt) {
			offlineWritesPar.push(local!);
			nextCursorPar = Math.max(nextCursorPar, localAt);
		} else {
			nextCursorPar = Math.max(nextCursorPar, remoteAt);
		}
	}
	// Wait for all the parallel puts to finish
	await Promise.all(putPromises);

	const endPar = performance.now();
	const parTime = endPar - startPar;
	console.log(`[Optimized] Parallel queries took: ${parTime.toFixed(2)}ms`);

	console.log(`\nImprovement: ${(seqTime / parTime).toFixed(2)}x faster!`);
}

runBenchmark().catch(console.error);
