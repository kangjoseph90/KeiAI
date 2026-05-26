import { describe, expect, it } from 'vitest';
import { denormalizeRisuTemplate, normalizeRisuTemplate } from '$lib/porters/risu/template';

describe('Risu template normalization', () => {
    it('normalizes simple macro aliases', () => {
        expect(normalizeRisuTemplate('{{lastmessageid}} {{getglobalvar::toggle_romance}}')).toBe(
            '{{lastmessageindex}} {{gettoggle::romance}}'
        );

        expect(normalizeRisuTemplate('{{chatindex}}')).toBe('{{messageindex}}');

        expect(normalizeRisuTemplate('<user> <bot> <char>')).toBe('{{user}} {{char}} {{char}}');

        expect(
            normalizeRisuTemplate(
                [
                    '{{authornote}}',
                    '{{isfirstmsg}}',
                    '{{personality}}',
                    '{{scenario}}',
                    '{{exampledialogue}}',
                    '{{mainprompt}}',
                    '{{globalnote}}'
                ].join(' ')
            )
        ).toBe(
            [
                '{{chatnote}}',
                '{{isfirstmessage}}',
                '{{characternote}}',
                '{{characternote}}',
                '{{characternote}}',
                '{{characternote}}',
                '{{characternote}}'
            ].join(' ')
        );
    });

    it('denormalizes simple macro aliases for Risu export', () => {
        expect(
            denormalizeRisuTemplate(
                '{{lastmessageindex}} {{gettoggle::romance}} {{characternote}} {{charnote}} {{messageindex}} {{msgindex}}'
            )
        ).toBe(
            '{{lastmessageid}} {{getglobalvar::toggle_romance}} {{globalnote}} {{globalnote}} {{chatindex}} {{chatindex}}'
        );
    });

    it('normalizes basic when blocks to if blocks', () => {
        expect(normalizeRisuTemplate('{{#when::1}}yes{{/}}')).toBe('{{#if 1}}yes{{/if}}');

        expect(normalizeRisuTemplate('{{#when::not::{{isfirstmsg}}}}no{{/when}}')).toBe(
            '{{#if not {{isfirstmessage}}}}no{{/if}}'
        );

        expect(normalizeRisuTemplate('{{#when::not::1::and::0}}yes{{/}}')).toBe(
            '{{#if not (1 and 0)}}yes{{/if}}'
        );
    });

    it('normalizes Risu when variable and toggle helpers', () => {
        expect(normalizeRisuTemplate('{{#when::var::counter}}yes{{/}}')).toBe(
            '{{#if {{getvar::counter}}}}yes{{/if}}'
        );

        expect(normalizeRisuTemplate('{{#when::toggle::romance}}yes{{/}}')).toBe(
            '{{#if {{gettoggle::romance}}}}yes{{/if}}'
        );
    });

    it('normalizes Risu when comparisons', () => {
        expect(normalizeRisuTemplate('{{#when::{{role}}::is::user}}yes{{/}}')).toBe(
            '{{#if {{role}} == "user"}}yes{{/if}}'
        );

        expect(normalizeRisuTemplate('{{#when::{{messageidleduration}}::>::60}}yes{{/}}')).toBe(
            '{{#if {{messageidleduration}} > 60}}yes{{/if}}'
        );

        expect(normalizeRisuTemplate('{{#when::mood::vis::happy}}yes{{/}}')).toBe(
            '{{#if {{getvar::mood}} == "happy"}}yes{{/if}}'
        );

        expect(normalizeRisuTemplate('{{#when::mode::tis::2}}yes{{/}}')).toBe(
            '{{#if {{gettoggle::mode}} == 2}}yes{{/if}}'
        );
    });

    it('normalizes right-associative when chains with explicit parentheses', () => {
        expect(normalizeRisuTemplate('{{#when::1::or::0::and::0}}yes{{/}}')).toBe(
            '{{#if 1 or (0 and 0)}}yes{{/if}}'
        );
    });

    it('normalizes macro aliases inside if conditions', () => {
        expect(normalizeRisuTemplate('{{#if {{chat_index}} == 1}}yes{{/if}}')).toBe(
            '{{#if {{messageindex}} == 1}}yes{{/if}}'
        );

        expect(
            normalizeRisuTemplate(
                '{{#if {{chat_index}} == 1}}one{{:elif {{chat_index}} == 2}}two{{/if}}'
            )
        ).toBe('{{#if {{messageindex}} == 1}}one{{:elif {{messageindex}} == 2}}two{{/if}}');
    });

    it('ignores Risu keep and legacy markers', () => {
        expect(normalizeRisuTemplate('{{#when::keep::1}}yes{{/}}')).toBe('{{#if 1}}yes{{/if}}');

        expect(normalizeRisuTemplate('{{#when::legacy::0}}{{:else}}no{{/}}')).toBe(
            '{{#if 0}}{{:else}}no{{/if}}'
        );
    });

    it('normalizes Risu each blocks', () => {
        expect(normalizeRisuTemplate('{{#each items}}{{slot::items}}{{/each}}')).toBe(
            '{{#each {{getvar::items}} as items}}{{slot::items}}{{/each}}'
        );

        expect(normalizeRisuTemplate('{{#each::keep items}}{{slot::items}}{{/}}')).toBe(
            '{{#each {{getvar::items}} as items}}{{slot::items}}{{/each}}'
        );

        expect(normalizeRisuTemplate('{{#each [1, 2, 3] n}}{{slot::n}}{{/}}')).toBe(
            '{{#each [1, 2, 3] as n}}{{slot::n}}{{/each}}'
        );

        expect(normalizeRisuTemplate('{{#each::keep [1,2,3] n}}{{slot::n}}{{/}}')).toBe(
            '{{#each [1,2,3] as n}}{{slot::n}}{{/each}}'
        );
    });

    it('normalizes each loop variables inside when operands', () => {
        expect(
            normalizeRisuTemplate('{{#each [1,2,3] as n}}{{#when::n::is::2}}yes{{/}}{{/}}')
        ).toBe('{{#each [1,2,3] as n}}{{#if {{slot::n}} == 2}}yes{{/if}}{{/each}}');
    });

    it('normalizes Risu puredisplay and if_pure blocks', () => {
        expect(normalizeRisuTemplate('{{#puredisplay}}{{char}}{{/puredisplay}}')).toBe(
            '{{#pure}}{{char}}{{/pure}}'
        );

        expect(normalizeRisuTemplate('{{#if_pure::1}}{{char}}{{:else}}{{user}}{{/}}')).toBe(
            '{{#if 1}}{{#pure}}{{char}}{{/pure}}{{:else}}{{#pure}}{{user}}{{/pure}}{{/if}}'
        );
    });
});
