export function sanitizeFileName(value: string): string {
    // eslint-disable-next-line no-control-regex
    return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '') || 'file';
}
