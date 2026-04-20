/**
 * MSW (Mock Service Worker) Handlers for PocketBase API
 *
 * Mocks all PocketBase endpoints used by the application for testing.
 */

import { http, HttpResponse } from 'msw';

// Base URL for PocketBase
const PB_URL = import.meta.env.VITE_PB_URL || 'http://127.0.0.1:8090';

// ─── In-Memory Data Store ───────────────────────────────────────────────

interface MockUser {
    id: string;
    email: string;
    name: string;
    password: string; // base64-encoded login key
    salt: string; // base64-encoded salt
    encryptedMasterKey: string; // base64-encoded ciphertext
    masterKeyIv: string; // base64-encoded IV
    encryptedRecoveryMasterKey: string;
    recoveryMasterKeyIv: string;
    recoveryAuthTokenHash: string;
    avatar?: string;
    created: string;
    updated: string;
}

const mockUsers = new Map<string, MockUser>();

// Auth token storage (email -> token)
const authTokens = new Map<string, string>();
// Token -> user mapping
const tokenToUser = new Map<string, MockUser>();

// Sync tables data
interface MockRecord {
    id: string;
    userId: string;
    createdAt: number;
    updatedAt: number;
    isDeleted: boolean;
    [key: string]: unknown;
}

const syncTables = {
    characters: new Map<string, MockRecord>(),
    chats: new Map<string, MockRecord>(),
    messages: new Map<string, MockRecord>(),
    settings: new Map<string, MockRecord>(),
    personas: new Map<string, MockRecord>(),
    lorebooks: new Map<string, MockRecord>(),
    scripts: new Map<string, MockRecord>(),
    modules: new Map<string, MockRecord>(),
    plugins: new Map<string, MockRecord>(),
    presets: new Map<string, MockRecord>(),
    assets: new Map<string, MockRecord>()
};

// Subscription tracking for realtime
const subscriptions = new Map<string, Set<(event: unknown) => void>>();

// ─── Helper Functions ───────────────────────────────────────────────────

function generateId(): string {
    return Math.random().toString(36).substring(2, 15);
}

function getCurrentUser(request: Request): MockUser | null {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader) return null;

    const token = authHeader.replace('Bearer ', '');
    return tokenToUser.get(token) || null;
}

function notifySubscribers(collection: string, action: string, record: MockRecord) {
    const key = `${collection}*`;
    const subs = subscriptions.get(key);
    if (subs) {
        subs.forEach((cb) =>
            cb({
                action,
                record
            })
        );
    }
}

// ─── Auth Endpoints ─────────────────────────────────────────────────────

export const handlers = [
    // GET /api/salt/{email} - Get user salt for login
    http.get(`${PB_URL}/api/salt/:email`, ({ params }) => {
        const email = params.email as string;
        const user = Array.from(mockUsers.values()).find((u) => u.email === email);

        if (!user) {
            return HttpResponse.json({ error: 'User not found' }, { status: 404 });
        }

        return HttpResponse.json({ salt: user.salt });
    }),

    // GET /api/recovery-bundle/{email} - Get recovery bundle
    http.get(`${PB_URL}/api/recovery-bundle/:email`, ({ params }) => {
        const email = params.email as string;
        const user = Array.from(mockUsers.values()).find((u) => u.email === email);

        if (!user) {
            return HttpResponse.json({ error: 'User not found' }, { status: 404 });
        }

        return HttpResponse.json({
            encryptedRecoveryMasterKey: user.encryptedRecoveryMasterKey,
            encryptedRecoveryMasterKeyIV: user.recoveryMasterKeyIv
        });
    }),

    // POST /api/recover-account/{email} - Recover account with new password
    http.post(`${PB_URL}/api/recover-account/:email`, async ({ params, request }) => {
        const email = params.email as string;
        const user = Array.from(mockUsers.values()).find((u) => u.email === email);

        if (!user) {
            return HttpResponse.json({ error: 'User not found' }, { status: 404 });
        }

        const body = (await request.json()) as Record<string, unknown>;
        user.password = body.password as string;
        user.salt = body.salt as string;
        user.encryptedMasterKey = body.encryptedMasterKey as string;
        user.masterKeyIv = body.masterKeyIv as string;
        user.encryptedRecoveryMasterKey = body.encryptedRecoveryMasterKey as string;
        user.recoveryMasterKeyIv = body.recoveryMasterKeyIv as string;
        user.recoveryAuthTokenHash = body.recoveryAuthTokenHash as string;
        user.updated = new Date().toISOString();

        return HttpResponse.json({ success: true });
    }),

    // POST /api/collections/users - Create user (register)
    http.post(`${PB_URL}/api/collections/users`, async ({ request }) => {
        const formData = await request.formData();
        const email = formData.get('email') as string;
        const password = formData.get('password') as string;
        const passwordConfirm = formData.get('passwordConfirm') as string;

        if (!email || !password || password !== passwordConfirm) {
            return HttpResponse.json({ error: 'Invalid request' }, { status: 400 });
        }

        const existing = Array.from(mockUsers.values()).find((u) => u.email === email);
        if (existing) {
            return HttpResponse.json({ error: 'Email already exists' }, { status: 400 });
        }

        const id = (formData.get('id') as string) || generateId();
        const now = new Date().toISOString();

        const user: MockUser = {
            id,
            email,
            name: (formData.get('name') as string) || 'User',
            password,
            salt: formData.get('salt') as string,
            encryptedMasterKey: formData.get('encryptedMasterKey') as string,
            masterKeyIv: formData.get('masterKeyIv') as string,
            encryptedRecoveryMasterKey: formData.get('encryptedRecoveryMasterKey') as string,
            recoveryMasterKeyIv: formData.get('recoveryMasterKeyIv') as string,
            recoveryAuthTokenHash: formData.get('recoveryAuthTokenHash') as string,
            avatar: formData.get('avatar') as string | undefined,
            created: now,
            updated: now
        };

        mockUsers.set(id, user);

        return HttpResponse.json(user);
    }),

    // POST /api/collections/users/auth-with-password - Login
    http.post(`${PB_URL}/api/collections/users/auth-with-password`, async ({ request }) => {
        const body = (await request.json()) as { identity: string; password: string };
        const { identity, password } = body;

        const user = Array.from(mockUsers.values()).find(
            (u) => u.email === identity && u.password === password
        );

        if (!user) {
            return HttpResponse.json({ error: 'Invalid credentials' }, { status: 401 });
        }

        // Generate and store token
        const token = `mock_token_${generateId()}`;
        authTokens.set(user.email, token);
        tokenToUser.set(token, user);

        return HttpResponse.json({
            token,
            record: user
        });
    }),

    // PATCH /api/collections/users/{id} - Update user
    http.patch(`${PB_URL}/api/collections/users/:id`, async ({ params, request }) => {
        const id = params.id as string;
        const user = mockUsers.get(id);
        const currentUser = getCurrentUser(request);

        if (!user || !currentUser) {
            return HttpResponse.json({ error: 'Not found' }, { status: 404 });
        }

        if (currentUser.id !== id) {
            return HttpResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = (await request.json()) as Record<string, unknown>;

        // Handle password change
        if (body.oldPassword && body.password) {
            // Verify old password
            if (user.password !== body.oldPassword) {
                return HttpResponse.json({ error: 'Invalid password' }, { status: 401 });
            }
            user.password = body.password as string;
        }

        if (body.salt) user.salt = body.salt as string;
        if (body.encryptedMasterKey) user.encryptedMasterKey = body.encryptedMasterKey as string;
        if (body.masterKeyIv) user.masterKeyIv = body.masterKeyIv as string;
        if (body.encryptedRecoveryMasterKey)
            user.encryptedRecoveryMasterKey = body.encryptedRecoveryMasterKey as string;
        if (body.recoveryMasterKeyIv) user.recoveryMasterKeyIv = body.recoveryMasterKeyIv as string;
        if (body.recoveryAuthTokenHash)
            user.recoveryAuthTokenHash = body.recoveryAuthTokenHash as string;

        user.updated = new Date().toISOString();

        return HttpResponse.json(user);
    }),

    // DELETE /api/collections/users/{id} - Delete user (unlink account)
    http.delete(`${PB_URL}/api/collections/users/:id`, async ({ params, request }) => {
        const id = params.id as string;
        const user = mockUsers.get(id);
        const currentUser = getCurrentUser(request);

        if (!user || !currentUser) {
            return HttpResponse.json({ error: 'Not found' }, { status: 404 });
        }

        if (currentUser.id !== id) {
            return HttpResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        mockUsers.delete(id);

        // Clear auth token
        for (const [email, token] of authTokens.entries()) {
            if (email === user.email) {
                tokenToUser.delete(token);
                authTokens.delete(email);
                break;
            }
        }

        return HttpResponse.json({ success: true });
    }),

    // ─── Sync Table Endpoints ────────────────────────────────────────────

    // GET /api/collections/{table} - List records with pagination
    http.get(`${PB_URL}/api/collections/:collection`, async ({ params, request }) => {
        const collection = params.collection as string;
        const url = new URL(request.url);
        const page = Number.parseInt(url.searchParams.get('page') || '1', 10);
        const perPage = Number.parseInt(url.searchParams.get('perPage') || '50', 10);
        const filter = url.searchParams.get('filter');

        const table = syncTables[collection as keyof typeof syncTables];
        if (!table) {
            return HttpResponse.json({ error: 'Collection not found' }, { status: 404 });
        }

        let records = Array.from(table.values());

        // Apply filter (simplified - only handles userId filter)
        if (filter && filter.includes('userId')) {
            const match = filter.match(/userId\s*=\s*['"]?([^['"]+)['"]?/);
            if (match) {
                const userId = match[1];
                records = records.filter((r) => r.userId === userId);
            }
        }

        // Sort by updatedAt
        records.sort((a, b) => b.updatedAt - a.updatedAt);

        // Pagination
        const start = (page - 1) * perPage;
        const end = start + perPage;
        const paginatedRecords = records.slice(start, end);

        return HttpResponse.json({
            page,
            perPage,
            totalItems: records.length,
            totalPages: Math.ceil(records.length / perPage),
            items: paginatedRecords
        });
    }),

    // POST /api/collections/{table} - Create record
    http.post(`${PB_URL}/api/collections/:collection`, async ({ params, request }) => {
        const collection = params.collection as string;
        const table = syncTables[collection as keyof typeof syncTables];

        if (!table) {
            return HttpResponse.json({ error: 'Collection not found' }, { status: 404 });
        }

        const record = (await request.json()) as MockRecord;
        const now = Date.now();

        const newRecord: MockRecord = {
            ...record,
            id: record.id || generateId(),
            createdAt: now,
            updatedAt: now
        };

        table.set(newRecord.id, newRecord);
        notifySubscribers(collection, 'create', newRecord);

        return HttpResponse.json(newRecord);
    }),

    // PATCH /api/collections/{table}/{id} - Update record
    http.patch(`${PB_URL}/api/collections/:collection/:id`, async ({ params, request }) => {
        const collection = params.collection as string;
        const id = params.id as string;
        const table = syncTables[collection as keyof typeof syncTables];

        if (!table) {
            return HttpResponse.json({ error: 'Collection not found' }, { status: 404 });
        }

        const existing = table.get(id);
        if (!existing) {
            return HttpResponse.json({ error: 'Record not found' }, { status: 404 });
        }

        const updates = (await request.json()) as Partial<MockRecord>;
        const updated: MockRecord = {
            ...existing,
            ...updates,
            id,
            updatedAt: Date.now()
        };

        table.set(id, updated);
        notifySubscribers(collection, 'update', updated);

        return HttpResponse.json(updated);
    }),

    // DELETE /api/collections/{table}/{id} - Delete record
    http.delete(`${PB_URL}/api/collections/:collection/:id`, async ({ params }) => {
        const collection = params.collection as string;
        const id = params.id as string;
        const table = syncTables[collection as keyof typeof syncTables];

        if (!table) {
            return HttpResponse.json({ error: 'Collection not found' }, { status: 404 });
        }

        const existing = table.get(id);
        if (!existing) {
            return HttpResponse.json({ error: 'Record not found' }, { status: 404 });
        }

        table.delete(id);
        notifySubscribers(collection, 'delete', existing);

        return HttpResponse.json({ success: true });
    })

    // ─── Realtime Subscription Endpoints ─────────────────────────────────

    // Mock subscribe (real PB uses SSE, we'll store callbacks)
    // This is handled by the mock PocketBase client below
];

// ─── Mock PocketBase Client ─────────────────────────────────────────────

/**
 * Mock PocketBase client for testing.
 * Import this in tests to override the real PocketBase client.
 */
export class MockPocketBase {
    public authStore = {
        token: null as string | null,
        record: null as MockUser | null,
        isValid: false,
        onChange: [] as ((token: string, model: MockUser | null) => void)[],

        clear() {
            this.token = null;
            this.record = null;
            this.isValid = false;
            this.onChange.forEach((cb) => cb('', null));
        },

        save(token: string, record: MockUser) {
            this.token = token;
            this.record = record;
            this.isValid = true;
            this.onChange.forEach((cb) => cb(token, record));
        }
    };

    private baseUrl: string;

    constructor(baseUrl?: string) {
        this.baseUrl = baseUrl || PB_URL;
    }

    collection(name: string) {
        return {
            // Get list with pagination
            getList: async (page = 1, perPage = 50, options?: Record<string, unknown>) => {
                const table = syncTables[name as keyof typeof syncTables];
                if (!table) {
                    throw new Error(`Collection ${name} not found`);
                }

                let records = Array.from(table.values());

                // Apply filter (simplified)
                if (options?.filter) {
                    const filterStr = options.filter as string;
                    if (filterStr.includes('userId')) {
                        const match = filterStr.match(/userId\s*=\s*{:userId}|"([^"]+)"/);
                        if (match) {
                            const userId = match[1] || '';
                            records = records.filter((r) => r.userId === userId);
                        }
                    }
                    if (filterStr.includes('updatedAt')) {
                        const match = filterStr.match(/updatedAt\s*>=\s*{:since}|"(\d+)"/);
                        if (match) {
                            const since = Number.parseInt(match[1] || '0', 10);
                            records = records.filter((r) => r.updatedAt >= since);
                        }
                    }
                }

                // Sort
                if (options?.sort === 'updatedAt') {
                    records.sort((a, b) => b.updatedAt - a.updatedAt);
                }

                // Pagination
                const start = (page - 1) * perPage;
                const end = start + perPage;
                const paginatedRecords = records.slice(start, end);

                return {
                    page,
                    perPage,
                    totalItems: records.length,
                    totalPages: Math.ceil(records.length / perPage),
                    items: paginatedRecords
                };
            },

            // Create record
            create: async (data: Record<string, unknown>) => {
                const table = syncTables[name as keyof typeof syncTables];
                if (!table) {
                    throw new Error(`Collection ${name} not found`);
                }

                const now = Date.now();
                const newRecord: MockRecord = {
                    id: (data.id as string) || generateId(),
                    userId: data.userId as string,
                    createdAt: now,
                    updatedAt: now,
                    isDeleted: false,
                    ...data
                };

                table.set(newRecord.id, newRecord);
                notifySubscribers(name, 'create', newRecord);

                return newRecord;
            },

            // Update record
            update: async (id: string, data: Record<string, unknown>) => {
                const table = syncTables[name as keyof typeof syncTables];
                if (!table) {
                    throw new Error(`Collection ${name} not found`);
                }

                const existing = table.get(id);
                if (!existing) {
                    const error = new Error('Record not found') as Error & { status: number };
                    error.status = 404;
                    throw error;
                }

                const updated: MockRecord = {
                    ...existing,
                    ...data,
                    id,
                    updatedAt: Date.now()
                };

                table.set(id, updated);
                notifySubscribers(name, 'update', updated);

                return updated;
            },

            // Get single record
            getOne: async (id: string) => {
                const table = syncTables[name as keyof typeof syncTables];
                if (!table) {
                    throw new Error(`Collection ${name} not found`);
                }

                const record = table.get(id);
                if (!record) {
                    const error = new Error('Record not found') as Error & { status: number };
                    error.status = 404;
                    throw error;
                }

                return record;
            },

            // Delete record
            delete: async (id: string) => {
                const table = syncTables[name as keyof typeof syncTables];
                if (!table) {
                    throw new Error(`Collection ${name} not found`);
                }

                const existing = table.get(id);
                if (!existing) {
                    const error = new Error('Record not found') as Error & { status: number };
                    error.status = 404;
                    throw error;
                }

                table.delete(id);
                notifySubscribers(name, 'delete', existing);

                return { success: true };
            },

            // Auth with password (for users collection)
            authWithPassword: async (identity: string, password: string) => {
                const user = Array.from(mockUsers.values()).find(
                    (u) => u.email === identity && u.password === password
                );

                if (!user) {
                    const error = new Error('Invalid credentials') as Error & { status: number };
                    error.status = 401;
                    throw error;
                }

                const token = `mock_token_${generateId()}`;
                this.authStore.save(token, user);

                return {
                    token,
                    record: user
                };
            },

            // Subscribe to realtime updates
            subscribe: async (_topic: string, callback: (event: unknown) => void) => {
                const key = `${name}*`;
                if (!subscriptions.has(key)) {
                    subscriptions.set(key, new Set());
                }
                subscriptions.get(key)!.add(callback);

                return Promise.resolve();
            },

            // Unsubscribe from realtime updates
            unsubscribe: async (_topic: string, callback?: (event: unknown) => void) => {
                const key = `${name}*`;
                const subs = subscriptions.get(key);
                if (subs) {
                    if (callback) {
                        subs.delete(callback);
                    } else {
                        subs.clear();
                    }
                }

                return Promise.resolve();
            }
        };
    }

    // Custom endpoint (for salt, recovery, etc.)
    async send(path: string, options?: RequestInit) {
        const url = `${this.baseUrl}${path}`;
        const response = await fetch(url, options);
        return response.json();
    }

    // File URL helper
    files = {
        getURL: (record: MockUser, filename: string) => {
            return `${this.baseUrl}/api/files/${record.id}/${filename}`;
        }
    };

    // Filter helper
    filter(template: string, params: Record<string, unknown>) {
        let filter = template;
        for (const [key, value] of Object.entries(params)) {
            filter = filter.replace(`{:${key}}`, `"${value}"`);
        }
        return filter;
    }
}

// ─── Test Utilities ─────────────────────────────────────────────────────

/**
 * Create a mock user for testing
 */
export function createMockUser(overrides?: Partial<MockUser>): MockUser {
    const id = generateId();
    return {
        id,
        email: `test${id.slice(0, 4)}@example.com`,
        name: 'Test User',
        password: 'mock_login_key_base64',
        salt: 'mock_salt_base64',
        encryptedMasterKey: 'mock_encrypted_key_base64',
        masterKeyIv: 'mock_iv_base64',
        encryptedRecoveryMasterKey: 'mock_recovery_key_base64',
        recoveryMasterKeyIv: 'mock_recovery_iv_base64',
        recoveryAuthTokenHash: 'mock_auth_token_hash_base64',
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        ...overrides
    };
}

/**
 * Clear all mock data
 */
export function clearMockData() {
    mockUsers.clear();
    authTokens.clear();
    tokenToUser.clear();
    for (const table of Object.values(syncTables)) {
        table.clear();
    }
    subscriptions.clear();
}
