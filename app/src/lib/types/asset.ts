export type AssetMediaType = 'image' | 'audio' | 'video' | 'other';

export const IMAGE_ASSET_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif'] as const;
export const AUDIO_ASSET_EXTENSIONS = ['mp3', 'wav', 'ogg', 'm4a', 'webm'] as const;
export const VIDEO_ASSET_EXTENSIONS = ['mp4', 'webm', 'mov'] as const;
export const DOCUMENT_ASSET_EXTENSIONS = ['pdf', 'docx', 'pptx', 'xlsx'] as const;
export const TEXT_ASSET_EXTENSIONS = [
    'txt',
    'md',
    'markdown',
    'csv',
    'tsv',
    'json',
    'xml',
    'html',
    'htm',
    'css',
    'js',
    'jsx',
    'ts',
    'tsx',
    'py',
    'java',
    'kt',
    'kts',
    'c',
    'h',
    'cpp',
    'hpp',
    'cs',
    'go',
    'rs',
    'rb',
    'php',
    'swift',
    'sh',
    'bash',
    'zsh',
    'ps1',
    'sql',
    'yaml',
    'yml',
    'toml',
    'ini',
    'log'
] as const;
export const MEDIA_ASSET_EXTENSIONS = [
    ...new Set([...IMAGE_ASSET_EXTENSIONS, ...AUDIO_ASSET_EXTENSIONS, ...VIDEO_ASSET_EXTENSIONS])
] as const;
export const FILE_ASSET_EXTENSIONS = [
    ...new Set([...MEDIA_ASSET_EXTENSIONS, ...DOCUMENT_ASSET_EXTENSIONS, ...TEXT_ASSET_EXTENSIONS])
] as const;

export const IMAGE_ASSET_MIME_TYPES = [
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif'
] as const;
export const AUDIO_ASSET_MIME_TYPES = [
    'audio/mpeg',
    'audio/wav',
    'audio/x-wav',
    'audio/ogg',
    'audio/webm',
    'audio/mp4'
] as const;
export const VIDEO_ASSET_MIME_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'] as const;
export const DOCUMENT_ASSET_MIME_TYPES = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
] as const;
export const TEXT_ASSET_MIME_TYPES = [
    'text/plain',
    'text/markdown',
    'text/csv',
    'text/tab-separated-values',
    'text/html',
    'text/css',
    'text/javascript',
    'text/xml',
    'application/json',
    'application/xml',
    'application/javascript',
    'application/sql',
    'application/toml',
    'application/x-yaml'
] as const;
export const MEDIA_ASSET_MIME_TYPES = [
    ...IMAGE_ASSET_MIME_TYPES,
    ...AUDIO_ASSET_MIME_TYPES,
    ...VIDEO_ASSET_MIME_TYPES
] as const;
export const FILE_ASSET_MIME_TYPES = [
    ...MEDIA_ASSET_MIME_TYPES,
    ...DOCUMENT_ASSET_MIME_TYPES,
    ...TEXT_ASSET_MIME_TYPES
] as const;

export interface AssetFields {
    name: string;
    hash: string;
    encKey: string;
    mimeType: string;
    width?: number;
    height?: number;
}

export type AssetStatus = 'local' | 'remote';
export type AssetEntries = Record<string, AssetStatus>;

export function getAssetMediaType(mimeType: string): AssetMediaType {
    const topLevelType = mimeType.trim().toLowerCase().split('/', 1)[0];
    if (topLevelType === 'image' || topLevelType === 'audio' || topLevelType === 'video') {
        return topLevelType;
    }
    return 'other';
}

export function isTextAsset(name: string, mimeType: string): boolean {
    const normalized = mimeType.trim().toLowerCase().split(';', 1)[0];
    if (
        normalized.startsWith('text/') ||
        (TEXT_ASSET_MIME_TYPES as readonly string[]).includes(normalized)
    ) {
        return true;
    }
    const extension = name.split('.').pop()?.toLowerCase() ?? '';
    return (TEXT_ASSET_EXTENSIONS as readonly string[]).includes(extension);
}
