<script module lang="ts">
    import hljs from 'highlight.js';
    import type { HTMLTextareaAttributes } from 'svelte/elements';

    export type SyntaxTextareaLanguage =
        | 'javascript'
        | 'markdown'
        | 'html'
        | 'css'
        | 'json'
        | 'none';
    export type SyntaxTextareaEvent = Event & { currentTarget: HTMLTextAreaElement };
    export type SyntaxTextareaKeyboardEvent = KeyboardEvent & {
        currentTarget: HTMLTextAreaElement;
    };
    export type SyntaxTextareaClipboardEvent = ClipboardEvent & {
        currentTarget: HTMLTextAreaElement;
    };
    export type SyntaxTextareaFocusEvent = FocusEvent & { currentTarget: HTMLTextAreaElement };

    export interface SyntaxTextareaProps {
        value?: string;
        ref?: HTMLTextAreaElement | null;
        placeholder?: string;
        disabled?: boolean;
        readonly?: boolean;
        showLineNumbers?: boolean;
        minRows?: number;
        maxHeight?: number;
        autoResize?: boolean;
        ariaLabel?: string;
        spellcheck?: boolean;
        class?: string;
        id?: string;
        name?: string;
        autocomplete?: HTMLTextareaAttributes['autocomplete'];
        autocapitalize?: HTMLTextareaAttributes['autocapitalize'];
        wrap?: HTMLTextareaAttributes['wrap'];
        language?: SyntaxTextareaLanguage;
        template?: boolean;
        templateSyntax?: boolean;
        compact?: boolean;
        onheightchange?: (height: number) => void;
        oninput?: (event: SyntaxTextareaEvent) => void;
        onchange?: (event: SyntaxTextareaEvent) => void;
        onkeydown?: (event: SyntaxTextareaKeyboardEvent) => void;
        onkeyup?: (event: SyntaxTextareaKeyboardEvent) => void;
        onpaste?: (event: SyntaxTextareaClipboardEvent) => void;
        onfocus?: (event: SyntaxTextareaFocusEvent) => void;
        onblur?: (event: SyntaxTextareaFocusEvent) => void;
    }

    interface TemplateRange {
        start: number;
        end: number;
        complete: boolean;
    }

    type TemplateTagKind = 'macro' | 'block' | 'comment';

    /** Finds complete and in-progress template tags using the runtime's nested-brace convention. */
    export function findTemplateRanges(source: string): TemplateRange[] {
        const ranges: TemplateRange[] = [];
        let cursor = 0;

        while (cursor < source.length) {
            const start = source.indexOf('{{', cursor);
            if (start < 0) break;

            let depth = 1;
            let scan = start + 2;
            let end = source.length;
            let complete = false;

            while (scan < source.length) {
                const nextOpen = source.indexOf('{{', scan);
                const nextClose = source.indexOf('}}', scan);

                if (nextClose < 0) break;

                if (nextOpen >= 0 && nextOpen < nextClose) {
                    depth += 1;
                    scan = nextOpen + 2;
                    continue;
                }

                depth -= 1;
                scan = nextClose + 2;
                if (depth === 0) {
                    end = scan;
                    complete = true;
                    break;
                }
            }

            ranges.push({ start, end, complete });
            cursor = end > start ? end : start + 2;
            if (!complete) break;
        }

        return ranges;
    }

    /** Highlights source code with optional language and composable template syntax highlighting. */
    export function highlightSource(
        source: string,
        options: { language?: SyntaxTextareaLanguage; template?: boolean } = {}
    ): string {
        const { language = 'none', template = false } = options;

        if (template) {
            const ranges = findTemplateRanges(source);
            if (ranges.length === 0) {
                return language !== 'none' ? highlight(source, language) : escapeHtml(source);
            }

            const placeholders = ranges.map(
                (_, index) =>
                    `${String.fromCodePoint(0xe000)}KEIAITEMPLATEX${toLetterCode(index)}X${String.fromCodePoint(0xe001)}`
            );
            let masked = source;

            for (let index = ranges.length - 1; index >= 0; index -= 1) {
                const range = ranges[index];
                masked = `${masked.slice(0, range.start)}${placeholders[index]}${masked.slice(range.end)}`;
            }

            let highlighted =
                language !== 'none' ? highlight(masked, language) : escapeHtml(masked);
            for (let index = 0; index < ranges.length; index += 1) {
                const range = ranges[index];
                const raw = source.slice(range.start, range.end);
                const code = toLetterCode(index);
                const pattern = new RegExp(
                    `\\uE000(?:<[^>]+>)*KEIAITEMPLATEX${code}X(?:<[^>]+>)*\\uE001`,
                    'g'
                );
                highlighted = highlighted.replace(pattern, renderTemplateTag(raw, range.complete));
            }

            return highlighted;
        }

        return language !== 'none' ? highlight(source, language) : escapeHtml(source);
    }

    function toLetterCode(index: number): string {
        let result = '';
        let current = index;
        do {
            result = String.fromCharCode(65 + (current % 26)) + result;
            current = Math.floor(current / 26) - 1;
        } while (current >= 0);
        return result;
    }

    export function highlightJavaScript(source: string): string {
        return highlightSource(source, { language: 'javascript' });
    }

    /** Highlights Markdown while preserving template tags as editor-owned spans. */
    export function highlightMarkdownTemplate(source: string): string {
        return highlightSource(source, { language: 'markdown', template: true });
    }

    function highlight(source: string, language: SyntaxTextareaLanguage): string {
        if (language === 'none') return escapeHtml(source);
        const lang = language === 'html' ? 'xml' : language;
        try {
            return hljs.highlight(source, { language: lang }).value;
        } catch {
            return escapeHtml(source);
        }
    }

    function renderTemplateTag(raw: string, complete: boolean): string {
        const open = raw.startsWith('{{') ? '{{' : '';
        const close = complete && raw.endsWith('}}') ? '}}' : '';
        const bodyStart = open.length;
        const bodyEnd = raw.length - close.length;
        const body = raw.slice(bodyStart, bodyEnd);
        const tag = classifyTemplateTag(body);
        const stateClass = complete ? '' : ' keiai-template-incomplete';

        return `<span class="keiai-template-tag keiai-template-tag-${tag.kind}${stateClass}"><span class="keiai-template-delimiter">${open}</span>${renderTemplateBody(body, tag)}<span class="keiai-template-delimiter">${close}</span></span>`;
    }

    function classifyTemplateTag(body: string): {
        kind: TemplateTagKind;
        markerStart: number;
        markerEnd: number;
        nameStart: number;
        nameEnd: number;
    } {
        const leadingLength = body.search(/\S|$/);
        const first = body[leadingLength];

        if (body.slice(leadingLength, leadingLength + 2) === '//') {
            return {
                kind: 'comment',
                markerStart: leadingLength,
                markerEnd: leadingLength + 2,
                nameStart: body.length,
                nameEnd: body.length
            };
        }

        const hasMarker = first === '#' || first === ':' || first === '/';
        const markerEnd = leadingLength + (hasMarker ? 1 : 0);
        const nameStart = skipWhitespace(body, markerEnd);
        const nameEnd = findNameEnd(body, nameStart);

        return {
            kind: hasMarker ? 'block' : 'macro',
            markerStart: leadingLength,
            markerEnd,
            nameStart,
            nameEnd
        };
    }

    function renderTemplateBody(
        body: string,
        tag: {
            kind: TemplateTagKind;
            markerStart: number;
            markerEnd: number;
            nameStart: number;
            nameEnd: number;
        }
    ): string {
        if (tag.kind === 'comment') {
            return `<span class="keiai-template-comment-body">${escapeHtml(body)}</span>`;
        }

        const parts = [
            escapeHtml(body.slice(0, tag.markerStart)),
            `<span class="keiai-template-marker">${escapeHtml(body.slice(tag.markerStart, tag.markerEnd))}</span>`,
            escapeHtml(body.slice(tag.markerEnd, tag.nameStart))
        ];

        if (tag.nameEnd > tag.nameStart) {
            parts.push(
                `<span class="keiai-template-name">${escapeHtml(body.slice(tag.nameStart, tag.nameEnd))}</span>`
            );
        }

        parts.push(
            `<span class="keiai-template-arguments">${escapeHtml(body.slice(tag.nameEnd))}</span>`
        );
        return parts.join('');
    }

    function skipWhitespace(value: string, start: number): number {
        let cursor = start;
        while (cursor < value.length && /\s/.test(value[cursor])) cursor += 1;
        return cursor;
    }

    function findNameEnd(value: string, start: number): number {
        let cursor = start;
        while (cursor < value.length && !/[\s:]/.test(value[cursor])) cursor += 1;
        return cursor;
    }

    function escapeHtml(value: string): string {
        return value
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    }
</script>

<script lang="ts">
    import { onMount } from 'svelte';
    import { cn } from '$lib/utils';

    type Props = SyntaxTextareaProps;

    let {
        value = $bindable(''),
        ref = $bindable(null),
        placeholder = '',
        disabled = false,
        readonly: readOnly = false,
        showLineNumbers = false,
        minRows = 8,
        maxHeight = 480,
        autoResize = false,
        ariaLabel,
        spellcheck = false,
        class: className = '',
        id,
        name,
        autocomplete,
        autocapitalize,
        wrap,
        onheightchange = (_height: number) => {},
        oninput = (_event: SyntaxTextareaEvent) => {},
        onchange = (_event: SyntaxTextareaEvent) => {},
        onkeydown = (_event: SyntaxTextareaKeyboardEvent) => {},
        onkeyup = (_event: SyntaxTextareaKeyboardEvent) => {},
        onpaste = (_event: SyntaxTextareaClipboardEvent) => {},
        onfocus = (_event: SyntaxTextareaFocusEvent) => {},
        onblur = (_event: SyntaxTextareaFocusEvent) => {},
        language = 'none',
        template = false,
        templateSyntax = false,
        compact = false
    }: Props = $props();

    let textareaEl: HTMLTextAreaElement | undefined = $state();
    let highlightEl: HTMLElement | undefined = $state();
    let gutterContentEl: HTMLElement | undefined = $state();
    let lastReportedHeight = 0;

    const isTemplateActive = $derived(template || templateSyntax);
    const highlighted = $derived(highlightSource(value, { language, template: isTemplateActive }));
    const resolvedWrap = $derived(
        wrap ??
            (compact || language === 'javascript' || language === 'css' || language === 'json'
                ? 'off'
                : 'soft')
    );
    const isWrapped = $derived(resolvedWrap !== 'off');
    const lineCount = $derived(Math.max(1, value.split('\n').length));
    const lineNumbers = $derived(Array.from({ length: lineCount }, (_, index) => index + 1));

    function resize(): void {
        if (!textareaEl || !autoResize || compact) return;

        textareaEl.style.height = 'auto';
        const borderHeight = textareaEl.offsetHeight - textareaEl.clientHeight;
        const naturalHeight = textareaEl.scrollHeight + borderHeight;
        const newHeight = Math.min(naturalHeight, maxHeight);
        textareaEl.style.height = `${newHeight}px`;
        textareaEl.style.overflowY = naturalHeight > maxHeight ? 'auto' : 'hidden';

        if (newHeight !== lastReportedHeight) {
            lastReportedHeight = newHeight;
            onheightchange(newHeight);
        }
    }

    function syncScroll(): void {
        if (!textareaEl) return;

        const x = -textareaEl.scrollLeft;
        const y = -textareaEl.scrollTop;
        if (highlightEl) highlightEl.style.transform = `translate(${x}px, ${y}px)`;
        if (gutterContentEl) gutterContentEl.style.transform = `translateY(${y}px)`;
    }

    function handleInput(event: Event): void {
        resize();
        syncScroll();
        oninput(event as SyntaxTextareaEvent);
    }

    function handleScroll(): void {
        syncScroll();
    }

    function handleKeyDown(event: KeyboardEvent): void {
        if (compact && event.key === 'Enter') {
            event.preventDefault();
        }
        onkeydown(event as SyntaxTextareaKeyboardEvent);
    }

    $effect(() => {
        ref = textareaEl ?? null;
    });

    $effect(() => {
        // Recalculate the overlay after external value updates and highlighting.
        void value;
        void highlighted;
        requestAnimationFrame(() => {
            resize();
            syncScroll();
        });
    });

    onMount(() => {
        resize();
        syncScroll();
    });
</script>

<div
    class={cn(
        'keiai-syntax-textarea flex min-w-0 overflow-hidden rounded-md border border-input bg-background dark:bg-input/30 shadow-xs transition-[color,box-shadow]',
        'focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]',
        compact && 'h-8 min-h-8',
        disabled && 'opacity-50 cursor-not-allowed',
        className
    )}
    class:keiai-syntax-compact={compact}
    class:keiai-syntax-wrap={isWrapped}
>
    {#if showLineNumbers && !compact}
        <div class="keiai-syntax-gutter shrink-0" aria-hidden="true">
            <div bind:this={gutterContentEl} class="keiai-syntax-gutter-content">
                {#each lineNumbers as lineNumber (lineNumber)}
                    <span class="keiai-syntax-line-number">{lineNumber}</span>
                {/each}
            </div>
        </div>
    {/if}

    <div class="keiai-syntax-viewport min-w-0 flex-1">
        <!-- eslint-disable svelte/no-at-html-tags -- highlight.js and the template renderer escape source text -->
        <pre bind:this={highlightEl} class="keiai-syntax-highlight" aria-hidden="true"><code
                class="hljs">{@html highlighted || ' '}</code
            ></pre>
        <!-- eslint-enable svelte/no-at-html-tags -->
        <textarea
            bind:this={textareaEl}
            bind:value
            {id}
            {name}
            {placeholder}
            {disabled}
            readonly={readOnly}
            {spellcheck}
            {autocomplete}
            {autocapitalize}
            wrap={resolvedWrap}
            rows={compact ? 1 : minRows}
            aria-label={ariaLabel || undefined}
            oninput={handleInput}
            {onchange}
            onscroll={handleScroll}
            onkeydown={handleKeyDown}
            {onkeyup}
            {onpaste}
            {onfocus}
            {onblur}
            class="keiai-syntax-input"
            style:max-height={compact ? '2rem' : `${maxHeight}px`}
        ></textarea>
    </div>
</div>

<style>
    :global(.keiai-syntax-textarea.resize-y) {
        resize: vertical;
    }

    .keiai-syntax-viewport {
        position: relative;
        overflow: hidden;
        min-height: 0;
        height: 100%;
    }

    .keiai-syntax-input,
    .keiai-syntax-highlight,
    .keiai-syntax-gutter-content {
        box-sizing: border-box;
        font-family:
            ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
            monospace;
        font-size: 0.8125rem;
        line-height: 1.5rem;
        tab-size: 4;
    }

    .keiai-syntax-input {
        position: relative;
        z-index: 1;
        display: block;
        width: 100%;
        min-height: 100%;
        min-width: 0;
        resize: none;
        overflow: auto;
        border: 0;
        background: transparent;
        padding: 0.625rem 0.75rem;
        color: transparent;
        /* The input text is transparent because the overlay renders it. Keep
           the native insertion caret visible independently of that color. */
        caret-color: var(--foreground);
        outline: none;
        white-space: pre;
        -webkit-text-fill-color: transparent;
    }

    .keiai-syntax-input::selection {
        background: color-mix(in oklab, var(--primary) 28%, transparent);
    }

    .keiai-syntax-input::placeholder {
        color: var(--muted-foreground);
        -webkit-text-fill-color: var(--muted-foreground);
    }

    .keiai-syntax-highlight {
        position: absolute;
        z-index: 0;
        inset: 0;
        width: max-content;
        min-width: 100%;
        margin: 0;
        overflow: visible;
        pointer-events: none;
        background: transparent;
        padding: 0.625rem 0.75rem;
        white-space: pre;
    }

    :global(.keiai-syntax-textarea.keiai-syntax-compact) .keiai-syntax-input,
    :global(.keiai-syntax-textarea.keiai-syntax-compact) .keiai-syntax-highlight {
        padding: 0.25rem 0.75rem;
        line-height: 1.25rem;
        font-size: 0.8125rem;
    }

    /* Override the global code-block theme: this code element is an overlay,
       so its padding/scroll container must match the textarea exactly. */
    .keiai-syntax-highlight > code.hljs {
        display: block;
        width: max-content;
        min-width: 100%;
        overflow: visible;
        padding: 0;
        background: transparent;
        font-family: inherit;
        font-size: inherit;
        font-weight: inherit;
        font-style: inherit;
        letter-spacing: inherit;
    }

    /* Highlight colors must not change glyph metrics: the native textarea
       owns the caret, while this overlay only paints the same text. */
    .keiai-syntax-highlight :global(*) {
        font-family: inherit;
        font-size: inherit;
        font-weight: inherit;
        font-style: inherit;
        letter-spacing: inherit;
    }

    .keiai-syntax-wrap .keiai-syntax-input {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
    }

    .keiai-syntax-wrap .keiai-syntax-highlight {
        width: 100%;
        min-width: 0;
    }

    .keiai-syntax-wrap .keiai-syntax-highlight > code.hljs {
        width: 100%;
        min-width: 0;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
    }

    .keiai-syntax-gutter {
        overflow: hidden;
        border-right: 1px solid var(--border);
        background: color-mix(in oklab, var(--muted) 28%, transparent);
        color: var(--muted-foreground);
        text-align: right;
        user-select: none;
    }

    .keiai-syntax-gutter-content {
        min-height: 100%;
        padding: 0.625rem 0.625rem 0.625rem 0.5rem;
    }

    .keiai-syntax-line-number {
        display: block;
        min-width: 2rem;
        height: 1.5rem;
    }

    :global(.keiai-template-tag) {
        background: transparent;
    }

    :global(.keiai-template-tag-macro) {
        color: var(--template-macro, #0284c7);
    }

    :global(.keiai-template-tag-block) {
        color: var(--template-block, #7c3aed);
    }

    :global(.keiai-template-tag-comment) {
        color: var(--highlight-comment, var(--muted-foreground));
        font-style: italic;
    }

    :global(.keiai-template-delimiter) {
        color: inherit;
        opacity: 0.75;
        font-weight: 500;
    }

    :global(.keiai-template-marker) {
        color: inherit;
        font-weight: 700;
    }

    :global(.keiai-template-name) {
        color: inherit;
        font-weight: 600;
    }

    :global(.keiai-template-arguments) {
        color: inherit;
        opacity: 0.85;
        font-weight: 400;
    }

    :global(.keiai-template-comment-body) {
        color: inherit;
        opacity: 0.9;
    }

    :global(.keiai-template-incomplete) {
        text-decoration: underline wavy var(--destructive);
        text-decoration-thickness: 1px;
        text-underline-offset: 2px;
    }
</style>
