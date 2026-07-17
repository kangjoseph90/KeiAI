export type ServerMode = 'default' | 'custom';
export type ProxyMode = 'default' | 'custom' | 'off';

export interface ServerConnectionSettings {
    mode: ServerMode;
    customUrl?: string;
}

export interface ProxyConnectionSettings {
    mode: ProxyMode;
    customUrl?: string;
}

export interface UserConnectionSettings {
    server: ServerConnectionSettings;
    proxy: ProxyConnectionSettings;
}

export function createDefaultUserConnections(): UserConnectionSettings {
    return {
        server: { mode: 'default' },
        proxy: { mode: 'default' }
    };
}
