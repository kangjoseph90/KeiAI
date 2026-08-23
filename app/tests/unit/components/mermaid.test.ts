import { describe, expect, it } from 'vitest';
import { renderMermaidSvg } from '$lib/components/hydrate';
import { sanitizeMermaidSvg } from '$lib/utils/style';

describe('mermaid diagram security', () => {
    it('renders a diagram through the app sanitize boundary', async () => {
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
