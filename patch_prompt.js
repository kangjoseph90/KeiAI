const fs = require('fs');
const content = fs.readFileSync('app/src/lib/workflow/agent/prompt.ts', 'utf8');

let newContent = content.replace(
    /async function buildFixedBlock\(block: PromptBlock, input: PromptInput\): Promise<PromptBlockResult> \{/,
    `async function resolveIndexString(
    value: string | undefined,
    input: PromptInput
): Promise<number | undefined> {
    if (value === undefined) return undefined;
    const templateMacros = mergeLocalMacros(input.localMacros, createDryRunMacros());
    const rendered = await runTemplate(value, input.ctx, templateMacros);
    const parsed = parseInt(rendered.trim(), 10);
    if (Number.isNaN(parsed)) {
        throw new AppError('INVALID_INPUT', \`Invalid history index configuration: \${value} (rendered as \${rendered})\`);
    }
    return parsed;
}

async function buildFixedBlock(block: PromptBlock, input: PromptInput): Promise<PromptBlockResult> {`
);

newContent = newContent.replace(
    /case 'history': \{\s*\/\/\s*Only bounded history gets processed here\s*const slice = await input\.messages\.slice\(block\.start, block\.end\);/,
    `case 'history': {
            // Only bounded history gets processed here
            const resolvedStart = await resolveIndexString(block.start, input);
            const resolvedEnd = await resolveIndexString(block.end, input);
            const slice = await input.messages.slice(resolvedStart, resolvedEnd);`
);

fs.writeFileSync('app/src/lib/workflow/agent/prompt.ts', newContent);
