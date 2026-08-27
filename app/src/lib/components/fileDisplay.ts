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

type SyntaxLanguageGroup = {
    language: SyntaxTextareaLanguage;
    extensions: readonly string[];
    mimeTypes?: readonly string[];
};

const SYNTAX_LANGUAGE_GROUPS: readonly SyntaxLanguageGroup[] = [
    { language: 'json', extensions: ['json', 'keipreset'], mimeTypes: ['application/json'] },
    {
        language: 'javascript',
        extensions: ['js', 'jsx', 'mjs', 'cjs'],
        mimeTypes: ['text/javascript', 'application/javascript']
    },
    { language: 'typescript', extensions: ['ts', 'tsx', 'mts', 'cts'] },
    {
        language: 'html',
        extensions: ['html', 'htm', 'svg', 'xml'],
        mimeTypes: ['text/html', 'text/xml', 'application/xml']
    },
    { language: 'css', extensions: ['css', 'scss', 'less'], mimeTypes: ['text/css'] },
    { language: 'markdown', extensions: ['md', 'markdown'], mimeTypes: ['text/markdown'] },
    { language: 'python', extensions: ['py', 'pyw'] },
    { language: 'yaml', extensions: ['yaml', 'yml'], mimeTypes: ['application/x-yaml'] },
    { language: 'sql', extensions: ['sql'], mimeTypes: ['application/sql'] },
    { language: 'rust', extensions: ['rs'] },
    { language: 'go', extensions: ['go'] },
    { language: 'cpp', extensions: ['cpp', 'cc', 'cxx', 'hpp', 'h'] },
    { language: 'c', extensions: ['c'] },
    { language: 'csharp', extensions: ['cs'] },
    { language: 'bash', extensions: ['sh', 'bash', 'zsh'] }
];

export function detectSyntaxLanguage(name: string, mime?: string): SyntaxTextareaLanguage {
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    const normalizedMime = mime?.trim().toLowerCase().split(';', 1)[0] ?? '';

    for (const group of SYNTAX_LANGUAGE_GROUPS) {
        if (group.extensions.includes(ext) || group.mimeTypes?.includes(normalizedMime)) {
            return group.language;
        }
    }
    return 'none';
}
