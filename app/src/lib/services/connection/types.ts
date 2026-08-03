export interface ConnectionChangeProgress {
    phase: 'validating' | 'localizing' | 'committing' | 'done';
    completed: number;
    total: number;
    currentItemId?: string;
}

export interface ConnectionChangeOptions {
    onProgress?: (progress: ConnectionChangeProgress) => void;
}

export interface ConnectionSpec {
    app: 'keiai' | 'keiai-proxy';
    protocol: number;
}
