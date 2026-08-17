import { describe, expect, it } from 'vitest';
import {
    findTemplateRanges,
    highlightJavaScript,
    highlightMarkdownTemplate,
    highlightSource
} from '$lib/components/SyntaxTextarea.svelte';

describe('syntax textarea highlighting', () => {
    it('highlights JavaScript through the existing highlight.js theme', () => {
        const result = highlightJavaScript('const answer = 42; // comment');

        expect(result).toContain('hljs-keyword');
        expect(result).toContain('hljs-number');
        expect(result).toContain('hljs-comment');
    });

    it('semantically highlights template macros and control-flow tags', () => {
        const result = highlightMarkdownTemplate(
            '# Title\n{{#if condition}}\n{{unknown_macro: value}}\n{{:else}}\n{{/if}}\n{{// comment}}'
        );

        expect(result).toContain('hljs-section');
        expect(result).toContain('keiai-template-tag');
        expect(result).toContain('keiai-template-tag-block');
        expect(result).toContain('keiai-template-tag-comment');
        expect(result).toContain('keiai-template-name');
        expect(result).toContain('{{');
        expect(result).toContain('unknown_macro');
        expect(result).toContain(': value');
    });

    it('highlights HTML and CSS code blocks with template support', () => {
        const htmlResult = highlightSource(
            '<div class="container">{{#if flag}}<span>{{user}}</span>{{/if}}</div>',
            {
                language: 'html',
                template: true
            }
        );
        expect(htmlResult).toContain('hljs-tag');
        expect(htmlResult).toContain('hljs-name');
        expect(htmlResult).toContain('keiai-template-tag');
        expect(htmlResult).toContain('user');

        const cssResult = highlightSource(
            '.status-panel { background: {{theme_bg}}; color: #fff; }',
            {
                language: 'css',
                template: true
            }
        );
        expect(cssResult).toContain('hljs-selector-class');
        expect(cssResult).toContain('hljs-attribute');
        expect(cssResult).toContain('keiai-template-tag');
        expect(cssResult).toContain('theme_bg');
    });

    it('highlights templates alone without markdown parsing when language is none', () => {
        const result = highlightSource('Replace $1 with {{char}} and *not bold*', {
            template: true,
            language: 'none'
        });

        expect(result).toContain('keiai-template-tag');
        expect(result).toContain('char');
        expect(result).not.toContain('hljs-emphasis');
        expect(result).toContain('*not bold*');
    });

    it('recognizes nested and incomplete template tags while editing', () => {
        expect(findTemplateRanges('{{outer {{inner}}}}')).toEqual([
            { start: 0, end: 19, complete: true }
        ]);
        expect(findTemplateRanges('before {{unfinished')).toEqual([
            { start: 7, end: 19, complete: false }
        ]);
    });
});
