import { describe, expect, it } from 'vitest';
import { readRisuTogglePanel, writeRisuTogglePanel } from '$lib/porters/risu/toggle';

describe('Risu toggle conversion', () => {
    it('converts linear group markers to EntityListConfig hierarchy', () => {
        const source = [
            '=Story=group=',
            'romance=Romance=checkbox=',
            '=Style=group=',
            'tone=Tone=select=Soft,Bold',
            '==groupEnd=',
            '==groupEnd=',
            'note=Note=textarea='
        ].join('\n');
        const panel = readRisuTogglePanel(source);
        const story = Object.values(panel.folders).find((folder) => folder.name === 'Story');
        const style = Object.values(panel.folders).find((folder) => folder.name === 'Style');
        const romance = Object.values(panel.refs).find(
            (item) => item.kind === 'control' && item.key === 'romance'
        );
        const tone = Object.values(panel.refs).find(
            (item) => item.kind === 'control' && item.key === 'tone'
        );

        expect(style?.parentId).toBe(story?.id);
        expect(romance?.folderId).toBe(story?.id);
        expect(tone?.folderId).toBe(style?.id);
        expect(writeRisuTogglePanel(panel)).toBe(source);
    });
});
