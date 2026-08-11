import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { parse } from 'svelte/compiler';

const ROOT = path.resolve('src');
const STRICT = process.argv.includes('--strict');
const JSON_OUTPUT = process.argv.includes('--json');
const UI_ATTRIBUTES = new Set(['alt', 'aria-label', 'aria-placeholder', 'placeholder', 'title']);
const UI_PROPERTIES = new Set([
    'alt',
    'ariaLabel',
    'cancelLabel',
    'caption',
    'closeLabel',
    'confirmLabel',
    'description',
    'emptyText',
    'help',
    'hint',
    'label',
    'loadingText',
    'placeholder',
    'subtitle',
    'title',
    'tooltip'
]);
const UI_CALLS = new Set(['appConfirm', 'toast']);

async function collectSvelteFiles(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) files.push(...(await collectSvelteFiles(target)));
        else if (entry.isFile() && entry.name.endsWith('.svelte')) files.push(target);
    }
    return files;
}

function walk(node, visit, parent = null) {
    if (!node || typeof node !== 'object') return;
    if (typeof node.type === 'string') visit(node, parent);
    for (const [key, value] of Object.entries(node)) {
        if (key === 'loc' || key === 'metadata') continue;
        if (Array.isArray(value)) {
            for (const child of value) walk(child, visit, node);
        } else if (value && typeof value === 'object') {
            walk(value, visit, node);
        }
    }
}

function hasHumanText(value) {
    return /\p{L}/u.test(value) && !/^https?:\/\//i.test(value.trim());
}

function propertyName(node) {
    if (!node || node.computed) return null;
    if (node.key?.type === 'Identifier') return node.key.name;
    if (node.key?.type === 'Literal') return String(node.key.value);
    return null;
}

function staticValue(node, source) {
    if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
    if (node?.type === 'TemplateLiteral') {
        return source.slice(node.start, node.end);
    }
    return null;
}

function callRootName(callee) {
    let current = callee;
    while (current?.type === 'MemberExpression') current = current.object;
    return current?.type === 'Identifier' ? current.name : null;
}

function lineStarts(source) {
    const starts = [0];
    for (let index = 0; index < source.length; index += 1) {
        if (source[index] === '\n') starts.push(index + 1);
    }
    return starts;
}

function positionAt(starts, offset) {
    let low = 0;
    let high = starts.length;
    while (low + 1 < high) {
        const middle = Math.floor((low + high) / 2);
        if (starts[middle] <= offset) low = middle;
        else high = middle;
    }
    return { line: low + 1, column: offset - starts[low] + 1 };
}

function isIgnored(lines, line) {
    const current = lines[line - 1] ?? '';
    const previous = lines[line - 2] ?? '';
    return current.includes('i18n-ignore:') || previous.includes('i18n-ignore:');
}

function inspectFile(file, source) {
    const ast = parse(source, { filename: file });
    const starts = lineStarts(source);
    const lines = source.split(/\r?\n/);
    const findings = new Map();

    function add(node, kind, text) {
        const value = text.trim().replace(/\s+/g, ' ');
        if (!hasHumanText(value)) return;
        const position = positionAt(starts, node.start);
        if (isIgnored(lines, position.line)) return;
        findings.set(`${node.start}:${kind}`, { ...position, kind, text: value });
    }

    walk(ast.html, (node, parent) => {
        if (node.type === 'Text' && parent?.type !== 'Attribute') {
            add(node, 'text', node.data);
            return;
        }
        if (node.type !== 'Attribute' || !UI_ATTRIBUTES.has(node.name)) return;
        if (!Array.isArray(node.value) || node.value.some((part) => part.type !== 'Text')) return;
        add(node, `attribute:${node.name}`, node.value.map((part) => part.data).join(''));
    });

    for (const script of [ast.instance?.content, ast.module?.content]) {
        walk(script, (node, parent) => {
            if (node.type === 'Property' && UI_PROPERTIES.has(propertyName(node))) {
                const value = staticValue(node.value, source);
                if (value !== null) add(node.value, `property:${propertyName(node)}`, value);
                return;
            }
            if (
                (node.type === 'Literal' || node.type === 'TemplateLiteral') &&
                parent?.type === 'CallExpression' &&
                UI_CALLS.has(callRootName(parent.callee))
            ) {
                const value = staticValue(node, source);
                if (value !== null) add(node, `call:${callRootName(parent.callee)}`, value);
            }
        });
    }

    return [...findings.values()];
}

const results = [];
for (const file of await collectSvelteFiles(ROOT)) {
    const source = await readFile(file, 'utf8');
    try {
        for (const finding of inspectFile(file, source)) {
            results.push({
                file: path.relative(process.cwd(), file).replaceAll('\\', '/'),
                ...finding
            });
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({
            file: path.relative(process.cwd(), file).replaceAll('\\', '/'),
            line: 1,
            column: 1,
            kind: 'parse-error',
            text: message
        });
    }
}

results.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column);

if (JSON_OUTPUT) {
    console.log(JSON.stringify(results, null, 2));
} else if (results.length === 0) {
    console.log('No untranslated UI text candidates found.');
} else {
    for (const result of results) {
        console.log(
            `${result.file}:${result.line}:${result.column} [${result.kind}] ${result.text}`
        );
    }
    console.log(`\n${results.length} untranslated UI text candidate(s).`);
    console.log('Use `i18n-ignore: reason` on the same or previous line for intentional literals.');
}

if (STRICT && results.length > 0) process.exitCode = 1;
