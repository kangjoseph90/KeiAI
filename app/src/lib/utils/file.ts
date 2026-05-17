export function downloadBytes(bytes: Uint8Array, fileName: string, mimeType: string): void {
    const blob = new Blob([bytes.slice()], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
}

export function sanitizeFileName(value: string): string {
    // eslint-disable-next-line no-control-regex
    return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '') || 'file';
}
