export type AssetMediaType = 'image' | 'audio' | 'video' | 'other';

export const IMAGE_ASSET_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif'] as const;
export const AUDIO_ASSET_EXTENSIONS = ['mp3', 'wav', 'ogg', 'm4a', 'webm'] as const;
export const VIDEO_ASSET_EXTENSIONS = ['mp4', 'webm', 'mov'] as const;
export const MEDIA_ASSET_EXTENSIONS = [
    ...new Set([...IMAGE_ASSET_EXTENSIONS, ...AUDIO_ASSET_EXTENSIONS, ...VIDEO_ASSET_EXTENSIONS])
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
export const MEDIA_ASSET_MIME_TYPES = [
    ...IMAGE_ASSET_MIME_TYPES,
    ...AUDIO_ASSET_MIME_TYPES,
    ...VIDEO_ASSET_MIME_TYPES
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
