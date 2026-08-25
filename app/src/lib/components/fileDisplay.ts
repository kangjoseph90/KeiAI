import { File as FileGenericIcon, FileCode, FileSpreadsheet, FileText } from 'lucide-svelte';
import type { SyntaxTextareaLanguage } from '$lib/components/SyntaxTextarea.svelte';

export function getFileIcon(name: string, mime?: string) {
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    if (ext === 'xlsx' || ext === 'csv' || ext === 'tsv') return FileSpreadsheet;
    if (
        ext === 'js' ||
        ext === 'ts' ||
        ext === 'py' ||
        ext === 'html' ||
        ext === 'css' ||
        ext === 'json' ||
        ext === 'rs' ||
        ext === 'go' ||
        ext === 'c' ||
        ext === 'cpp'
    ) {
        return FileCode;
    }
    if (ext === 'txt' || ext === 'md' || ext === 'docx' || ext === 'pptx') return FileText;
    if (mime?.startsWith('text/')) return FileText;
    return FileGenericIcon;
}

export function detectSyntaxLanguage(name: string, mime?: string): SyntaxTextareaLanguage {
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    const normalizedMime = mime?.trim().toLowerCase().split(';', 1)[0] ?? '';

    if (ext === 'json' || ext === 'keipreset' || normalizedMime === 'application/json') {
        return 'json';
    }
    if (
        ext === 'js' ||
        ext === 'jsx' ||
        ext === 'mjs' ||
        ext === 'cjs' ||
        normalizedMime === 'text/javascript' ||
        normalizedMime === 'application/javascript'
    ) {
        return 'javascript';
    }
    if (ext === 'ts' || ext === 'tsx' || ext === 'mts' || ext === 'cts') {
        return 'typescript';
    }
    if (
        ext === 'html' ||
        ext === 'htm' ||
        ext === 'svg' ||
        ext === 'xml' ||
        normalizedMime === 'text/html' ||
        normalizedMime === 'text/xml' ||
        normalizedMime === 'application/xml'
    ) {
        return 'html';
    }
    if (ext === 'css' || ext === 'scss' || ext === 'less' || normalizedMime === 'text/css') {
        return 'css';
    }
    if (ext === 'md' || ext === 'markdown' || normalizedMime === 'text/markdown') {
        return 'markdown';
    }
    if (ext === 'py' || ext === 'pyw') {
        return 'python';
    }
    if (ext === 'yaml' || ext === 'yml' || normalizedMime === 'application/x-yaml') {
        return 'yaml';
    }
    if (ext === 'sql' || normalizedMime === 'application/sql') {
        return 'sql';
    }
    if (ext === 'rs') {
        return 'rust';
    }
    if (ext === 'go') {
        return 'go';
    }
    if (ext === 'cpp' || ext === 'cc' || ext === 'cxx' || ext === 'hpp' || ext === 'h') {
        return 'cpp';
    }
    if (ext === 'c') {
        return 'c';
    }
    if (ext === 'cs') {
        return 'csharp';
    }
    if (ext === 'sh' || ext === 'bash' || ext === 'zsh') {
        return 'bash';
    }
    return 'none';
}
