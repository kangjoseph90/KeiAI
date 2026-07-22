export interface ConnectionChangeProgress {
    phase: 'validating' | 'localizing' | 'committing' | 'done';
    completed: number;
    total: number;
    currentItemId?: string;
}

export interface ConnectionChangeOptions {
    onProgress?: (progress: ConnectionChangeProgress) => void;
}

export interface ServerCapabilities {
    app: 'keiai';
    protocol: number;
    capabilities?: string[];
}

export interface ProxyCapabilities {
    service: 'keiai-proxy';
    protocolVersion: number;
    capabilities: string[];
}
