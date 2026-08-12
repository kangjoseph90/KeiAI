import { runInferenceCacheMutation } from '$lib/inference/cache-coordinator';

const MODEL_CACHE_NAMES = ['transformers-cache', 'kokoro-voices'] as const;
type ModelCacheName = (typeof MODEL_CACHE_NAMES)[number];

interface ModelCacheFile {
    cacheName: ModelCacheName;
    url: string;
    sizeBytes?: number;
}

export interface CachedTransformersModel {
    key: string;
    modelId: string;
    revision: string;
    name: string;
    fileCount: number;
    sizeBytes: number;
    sizeKnown: boolean;
}

export interface TransformersModelCacheSnapshot {
    available: boolean;
    models: CachedTransformersModel[];
    totalBytes: number;
    totalSizeKnown: boolean;
}

interface CachedModelGroup extends CachedTransformersModel {
    files: ModelCacheFile[];
}

export class TransformersModelCacheService {
    constructor(
        private readonly cacheStorage: CacheStorage | undefined = getCacheStorage(),
        private readonly runMutation: <T>(
            action: () => Promise<T>
        ) => Promise<T> = runInferenceCacheMutation
    ) {}

    async inspect(): Promise<TransformersModelCacheSnapshot> {
        const files = await this.inspectFiles();
        if (!files) {
            return { available: false, models: [], totalBytes: 0, totalSizeKnown: false };
        }

        const models = groupModelFiles(files);
        return {
            available: true,
            models: models.map(({ files: _files, ...model }) => model),
            totalBytes: models.reduce((total, model) => total + model.sizeBytes, 0),
            totalSizeKnown: models.every((model) => model.sizeKnown)
        };
    }

    async deleteModels(keys: readonly string[]): Promise<number> {
        if (keys.length === 0 || !this.cacheStorage) return 0;
        return this.runMutation(async () => {
            const files = await this.inspectFiles();
            if (!files) return 0;

            const selected = new Set(keys);
            const targets = groupModelFiles(files)
                .filter((model) => selected.has(model.key))
                .flatMap((model) => model.files);
            if (targets.length === 0) return 0;

            const deleted = await this.deleteFiles(targets);
            if (deleted !== targets.length) {
                throw new Error(
                    `Only ${deleted} of ${targets.length} model cache files were deleted`
                );
            }
            return deleted;
        });
    }

    private async inspectFiles(): Promise<ModelCacheFile[] | null> {
        if (!this.cacheStorage) return null;
        try {
            const existingNames = new Set(await this.cacheStorage.keys());
            return (
                await Promise.all(
                    MODEL_CACHE_NAMES.filter((name) => existingNames.has(name)).map((name) =>
                        this.inspectBucket(name)
                    )
                )
            ).flat();
        } catch {
            return null;
        }
    }

    private async inspectBucket(cacheName: ModelCacheName): Promise<ModelCacheFile[]> {
        const cache = await this.cacheStorage!.open(cacheName);
        const requests = await cache.keys();
        return Promise.all(
            requests.map(async (request) => {
                const response = await cache.match(request);
                const contentLength = response?.headers.get('content-length');
                const sizeBytes = contentLength === null ? undefined : Number(contentLength);
                return {
                    cacheName,
                    url: request.url,
                    ...(sizeBytes !== undefined && Number.isFinite(sizeBytes) && sizeBytes >= 0
                        ? { sizeBytes }
                        : {})
                };
            })
        );
    }

    private async deleteFiles(files: readonly ModelCacheFile[]): Promise<number> {
        const existingNames = new Set(await this.cacheStorage!.keys());
        const results = await Promise.all(
            MODEL_CACHE_NAMES.filter((name) => existingNames.has(name)).flatMap((cacheName) => {
                const urls = files
                    .filter((file) => file.cacheName === cacheName)
                    .map((file) => file.url);
                if (urls.length === 0) return [];
                return [
                    this.cacheStorage!.open(cacheName).then((cache) =>
                        Promise.all(urls.map((url) => cache.delete(url)))
                    )
                ];
            })
        );
        return results.flat().filter(Boolean).length;
    }
}

function getCacheStorage(): CacheStorage | undefined {
    return typeof caches === 'undefined' ? undefined : caches;
}

function groupModelFiles(files: ModelCacheFile[]): CachedModelGroup[] {
    const groups = new Map<string, CachedModelGroup>();
    for (const file of files) {
        const parsed = parseModelUrl(file.url);
        if (!parsed) continue;
        const key = `${parsed.modelId}@${parsed.revision}`;
        const group = groups.get(key) ?? {
            key,
            ...parsed,
            name: parsed.modelId.split('/').at(-1)!,
            fileCount: 0,
            sizeBytes: 0,
            sizeKnown: true,
            files: []
        };
        group.fileCount += 1;
        group.files.push(file);
        if (file.sizeBytes === undefined) group.sizeKnown = false;
        else group.sizeBytes += file.sizeBytes;
        groups.set(key, group);
    }
    return [...groups.values()].sort(
        (a, b) => b.sizeBytes - a.sizeBytes || a.name.localeCompare(b.name)
    );
}

export function parseModelUrl(url: string): { modelId: string; revision: string } | null {
    try {
        const parsed = new URL(url);
        if (parsed.hostname !== 'huggingface.co' && parsed.hostname !== 'hf.co') return null;
        const segments = parsed.pathname.split('/').filter(Boolean).map(decodeURIComponent);
        const resolveIndex = segments[2] === 'resolve' ? 2 : segments[1] === 'resolve' ? 1 : -1;
        if (resolveIndex < 1 || resolveIndex + 1 >= segments.length) return null;
        return {
            modelId: segments.slice(0, resolveIndex).join('/'),
            revision: segments[resolveIndex + 1]
        };
    } catch {
        return null;
    }
}

export const transformersModelCache = new TransformersModelCacheService();
