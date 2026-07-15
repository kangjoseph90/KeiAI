/**
 * Composer attachment helpers — pure logic shared by file pick, paste, and drop.
 *
 * These functions have no side effects and no knowledge of stores/services.
 * The caller (ChatView) owns the async inlay creation and pending-attachment state.
 */

// ─── Limits & Allowlist ──────────────────────────────────────────────────────

export const MAX_ATTACHMENTS = 4;

/**
 * MIME types accepted as image attachments.
 * `image/*` is intentionally NOT accepted wholesale — only formats the asset
 * pipeline (WebP transcode) and supported models handle.
 */
export const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;

/**
 * Extensions used as a fallback only when the MIME type is empty/unknown.
 * Kept in sync with the dialog filter extensions in ChatView.
 */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif'] as const;

// ─── Validation ──────────────────────────────────────────────────────────────

function extOf(fileName: string): string {
    const dot = fileName.lastIndexOf('.');
    return dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : '';
}

function isAllowedExtension(fileName: string): boolean {
    return (IMAGE_EXTENSIONS as readonly string[]).includes(extOf(fileName));
}

function isAllowedMime(mime: string): boolean {
    return (IMAGE_MIME_TYPES as readonly string[]).includes(mime);
}

/**
 * True when the file is one of the allowlisted image formats.
 * MIME is authoritative; the extension is consulted only when MIME is missing.
 */
export function isImageFile(file: { name: string; type: string }): boolean {
    return file.type ? isAllowedMime(file.type) : isAllowedExtension(file.name);
}

/**
 * Filter to image files, then cap at `remainingSlots` preserving order.
 * A non-positive `remainingSlots` returns an empty array.
 */
export function selectImageFiles(files: File[], remainingSlots: number): File[] {
    if (remainingSlots <= 0) return [];
    const images: File[] = [];
    for (const file of files) {
        if (images.length >= remainingSlots) break;
        if (isImageFile(file)) images.push(file);
    }
    return images;
}

// ─── Event Extraction ────────────────────────────────────────────────────────

/**
 * Extract image Files from a paste event.
 *
 * Prefers `clipboardData.files`; only falls back to `clipboardData.items`
 * (File-backed image items) when no files are present, to avoid duplicates.
 * Text-only pastes return an empty array so the browser default is preserved.
 */
export function extractImageFilesFromPaste(e: ClipboardEvent): File[] {
    const dt = e.clipboardData;
    if (!dt) return [];

    const fromFiles = dt.files ? Array.from(dt.files) : [];
    if (fromFiles.length > 0) {
        return fromFiles.filter(isImageFile);
    }

    const images: File[] = [];
    if (dt.items) {
        for (const item of Array.from(dt.items)) {
            if (item.kind !== 'file') continue;
            const file = item.getAsFile();
            if (file && isImageFile(file)) images.push(file);
        }
    }
    return images;
}

/**
 * Extract image Files from a drop event's dataTransfer.
 */
export function extractImageFilesFromDrop(e: DragEvent): File[] {
    const dt = e.dataTransfer;
    if (!dt?.files) return [];
    return Array.from(dt.files).filter(isImageFile);
}

/**
 * Whether a drag event carries droppable files — used to show the drop overlay.
 *
 * During `dragover` the `files` list is often still empty, so we also accept
 * the presence of `"Files"` in `dataTransfer.types`.
 */
export function hasDroppableFiles(e: DragEvent): boolean {
    const dt = e.dataTransfer;
    if (!dt) return false;
    if (dt.files && dt.files.length > 0) return true;
    return Array.from(dt.types ?? []).includes('Files');
}
