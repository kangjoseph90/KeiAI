import { describe, expect, it } from 'vitest';
import { File as FileGenericIcon, FileCode, FileSpreadsheet, FileText } from 'lucide-svelte';
import { detectSyntaxLanguage, getFileIcon } from '$lib/components/fileDisplay';

describe('file display mapping', () => {
    it('returns specific icon components for known file kinds', () => {
        expect(getFileIcon('data.xlsx')).toBe(FileSpreadsheet);
        expect(getFileIcon('script.ts')).toBe(FileCode);
        expect(getFileIcon('document.docx')).toBe(FileText);
        expect(getFileIcon('notes.txt', 'text/plain')).toBe(FileText);
        expect(getFileIcon('unknown.bin')).toBe(FileGenericIcon);
    });

    it('detects syntax highlighting language from filename and mime', () => {
        expect(detectSyntaxLanguage('script.js')).toBe('javascript');
        expect(detectSyntaxLanguage('app.tsx')).toBe('typescript');
        expect(detectSyntaxLanguage('data.json')).toBe('json');
        expect(detectSyntaxLanguage('index.html')).toBe('html');
        expect(detectSyntaxLanguage('style.css')).toBe('css');
        expect(detectSyntaxLanguage('README.md')).toBe('markdown');
        expect(detectSyntaxLanguage('script.py')).toBe('python');
        expect(detectSyntaxLanguage('config.yaml')).toBe('yaml');
        expect(detectSyntaxLanguage('query.sql')).toBe('sql');
        expect(detectSyntaxLanguage('main.rs')).toBe('rust');
        expect(detectSyntaxLanguage('notes.txt')).toBe('none');
        expect(detectSyntaxLanguage('report.docx')).toBe('none');
    });
});
