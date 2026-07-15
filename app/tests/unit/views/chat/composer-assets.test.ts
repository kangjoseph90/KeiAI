import { describe, expect, it } from 'vitest';
import {
    IMAGE_MIME_TYPES,
    extractImageFilesFromDrop,
    extractImageFilesFromPaste,
    hasDroppableFiles,
    isImageFile,
    selectImageFiles
} from '$lib/views/chat/composer-assets';

// ─── Stub builders ───────────────────────────────────────────────────────────
// happy-dom's ClipboardEvent/DragEvent/DataTransfer constructors are unverified,
// so tests cast minimal plain objects to the event types the helpers read.
// Reusing module-scope File fixtures keeps `toEqual` stable (same lastModified).

interface StubDataTransfer {
    files?: File[];
    items?: Array<{ kind: string; type: string; getAsFile: () => File | null }>;
    types?: string[];
}

function clipboardEvent(data: StubDataTransfer): ClipboardEvent {
    return { clipboardData: data } as unknown as ClipboardEvent;
}

function dragEvent(data: StubDataTransfer): DragEvent {
    return { dataTransfer: data } as unknown as DragEvent;
}

function fileItem(file: File | null): {
    kind: string;
    type: string;
    getAsFile: () => File | null;
} {
    return {
        kind: file ? 'file' : 'string',
        type: file?.type ?? '',
        getAsFile: () => file
    };
}

const PNG = new File(['\x89PNG'], 'a.png', { type: 'image/png' });
const JPEG = new File(['data'], 'b.jpg', { type: 'image/jpeg' });
const WEBP = new File(['data'], 'c.webp', { type: 'image/webp' });
const TXT = new File(['t'], 'a.txt', { type: 'text/plain' });

// ─── isImageFile ─────────────────────────────────────────────────────────────

describe('isImageFile', () => {
    it.each(IMAGE_MIME_TYPES)('accepts allowlisted MIME %s', (mime) => {
        expect(isImageFile({ name: 'x', type: mime })).toBe(true);
    });

    it('rejects non-allowlisted image MIME like image/svg+xml', () => {
        expect(isImageFile({ name: 'icon.svg', type: 'image/svg+xml' })).toBe(false);
    });

    it('rejects non-image MIME', () => {
        expect(isImageFile({ name: 'doc.txt', type: 'text/plain' })).toBe(false);
        expect(isImageFile({ name: 'doc.pdf', type: 'application/pdf' })).toBe(false);
    });

    it('falls back to extension when MIME is empty', () => {
        expect(isImageFile({ name: 'photo.png', type: '' })).toBe(true);
        expect(isImageFile({ name: 'photo.JPEG', type: '' })).toBe(true); // case-insensitive
        expect(isImageFile({ name: 'notes.txt', type: '' })).toBe(false);
    });

    it('ignores extension when MIME is present and disallowed', () => {
        // A .png file mislabeled as text/plain is rejected — MIME wins.
        expect(isImageFile({ name: 'photo.png', type: 'text/plain' })).toBe(false);
    });
});

// ─── selectImageFiles ────────────────────────────────────────────────────────

describe('selectImageFiles', () => {
    it('filters to image files and preserves order', () => {
        expect(selectImageFiles([PNG, TXT, JPEG], 4)).toEqual([PNG, JPEG]);
    });

    it('caps at remainingSlots', () => {
        expect(selectImageFiles([PNG, JPEG, WEBP], 2)).toEqual([PNG, JPEG]);
    });

    it('returns empty for non-positive slots', () => {
        expect(selectImageFiles([PNG], 0)).toEqual([]);
        expect(selectImageFiles([PNG], -1)).toEqual([]);
    });

    it('returns empty when no images', () => {
        expect(selectImageFiles([TXT], 4)).toEqual([]);
    });
});

// ─── extractImageFilesFromPaste ──────────────────────────────────────────────

describe('extractImageFilesFromPaste', () => {
    it('returns [] when clipboardData is absent', () => {
        expect(extractImageFilesFromPaste({} as ClipboardEvent)).toEqual([]);
    });

    it('extracts images from clipboardData.files', () => {
        expect(extractImageFilesFromPaste(clipboardEvent({ files: [PNG, JPEG] }))).toEqual([
            PNG,
            JPEG
        ]);
    });

    it('filters non-images out of files', () => {
        expect(extractImageFilesFromPaste(clipboardEvent({ files: [PNG, TXT] }))).toEqual([PNG]);
    });

    it('text-only paste returns [] so the browser default is preserved', () => {
        expect(extractImageFilesFromPaste(clipboardEvent({ files: [TXT] }))).toEqual([]);
    });

    it('falls back to items only when files is empty (no duplicates)', () => {
        expect(
            extractImageFilesFromPaste(
                clipboardEvent({ files: [], items: [fileItem(PNG), fileItem(JPEG)] })
            )
        ).toEqual([PNG, JPEG]);
    });

    it('items fallback skips non-image file items and string items', () => {
        expect(
            extractImageFilesFromPaste(
                clipboardEvent({
                    files: [],
                    items: [
                        fileItem(PNG),
                        fileItem(TXT),
                        { kind: 'string', type: 'text/plain', getAsFile: () => null }
                    ]
                })
            )
        ).toEqual([PNG]);
    });

    it('does not double-extract when both files and items contain the image', () => {
        expect(
            extractImageFilesFromPaste(clipboardEvent({ files: [PNG], items: [fileItem(PNG)] }))
        ).toEqual([PNG]);
    });
});

// ─── extractImageFilesFromDrop ───────────────────────────────────────────────

describe('extractImageFilesFromDrop', () => {
    it('returns [] when dataTransfer is absent', () => {
        expect(extractImageFilesFromDrop({} as DragEvent)).toEqual([]);
    });

    it('extracts images from dataTransfer.files', () => {
        expect(extractImageFilesFromDrop(dragEvent({ files: [PNG, JPEG] }))).toEqual([PNG, JPEG]);
    });

    it('filters non-images', () => {
        expect(extractImageFilesFromDrop(dragEvent({ files: [PNG, TXT] }))).toEqual([PNG]);
    });

    it('returns [] when files is empty', () => {
        expect(extractImageFilesFromDrop(dragEvent({ files: [] }))).toEqual([]);
    });
});

// ─── hasDroppableFiles ───────────────────────────────────────────────────────

describe('hasDroppableFiles', () => {
    it('returns true when files are present', () => {
        expect(hasDroppableFiles(dragEvent({ files: [PNG] }))).toBe(true);
    });

    it('returns true when files is empty but types contains "Files" (dragover)', () => {
        expect(hasDroppableFiles(dragEvent({ files: [], types: ['Files'] }))).toBe(true);
    });

    it('returns false for a text/string drag', () => {
        expect(hasDroppableFiles(dragEvent({ files: [], types: ['text/plain'] }))).toBe(false);
    });

    it('returns false when dataTransfer is absent', () => {
        expect(hasDroppableFiles({} as DragEvent)).toBe(false);
    });
});
