import { describe, expect, it } from 'vitest';
import { renderMermaidSvg, stripMermaidClickDirectives } from '$lib/components/hydrate';
import { sanitizeMermaidSvg } from '$lib/utils/style';

describe('mermaid click directives', () => {
    it('drops click directive lines wherever they appear', () => {
        const source = [
            'graph TD',
            '  A[Normal] --> B[Node]',
            '  click A "https://evil.example/exploit" "go"',
            '\tclick B callback "cb"',
            '  C --> D'
        ].join('\n');

        expect(stripMermaidClickDirectives(source)).toBe(
            'graph TD\n  A[Normal] --> B[Node]\n\n\n  C --> D'
        );
    });

    it('keeps lines that merely mention click', () => {
        const source = 'graph TD\n  A[clicked it] --> B[one click away]';

        expect(stripMermaidClickDirectives(source)).toBe(source);
    });
});

describe('mermaid diagram security', () => {
    it('renders a diagram through the app sanitize boundary', async () => {
        // happy-dom cannot lay out diagrams, so label rendering is verified in
        // the browser; this covers the config and sanitize boundary.
        const svg = await renderMermaidSvg('graph TD\n  A[Start] --> B{Choice}', 'default');

        expect(svg).toContain('<svg');
        expect(svg).not.toMatch(/<a[\s>]/);
        expect(svg).not.toContain('<script');
    });

    it('strips navigation, scripts, images, and event handlers from diagram SVG', () => {
        // happy-dom corrupts DOMPurify's tree walk once an element is removed,
        // so each threat is sanitized in isolation; the combined pipeline is
        // verified in the browser.
        expect(sanitizeMermaidSvg('<svg><script>alert(1)</script></svg>')).not.toContain('<script');

        expect(
            sanitizeMermaidSvg('<svg><a href="https://evil.example"><text>x</text></a></svg>')
        ).not.toMatch(/<a[\s>]/);

        expect(
            sanitizeMermaidSvg('<svg><image href="https://evil.example/p.png"/></svg>')
        ).not.toContain('image');

        expect(sanitizeMermaidSvg('<svg><path d="M0 0" onerror="alert(3)"/></svg>')).not.toContain(
            'onerror'
        );

        expect(
            sanitizeMermaidSvg('<svg><text href="javascript:alert(9)">x</text></svg>')
        ).not.toContain('javascript:');

        const safe = sanitizeMermaidSvg('<svg><path d="M0 0"/><text>safe</text></svg>');
        expect(safe).toContain('d="M0 0"');
        expect(safe).toContain('safe');
    });
});
