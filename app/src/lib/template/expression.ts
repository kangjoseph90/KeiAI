import type { Template, TemplateNode } from './types';

type Associativity = 'left' | 'right';

export type ExprValue = string | number | boolean | null;

type ValueNode = Exclude<TemplateNode, { type: 'text' }>;
type ResolveNode = (node: ValueNode) => Promise<string>;

interface Operator {
    precedence: number;
    associativity: Associativity;
    arity: 1 | 2;
    run: (a: ExprValue, b?: ExprValue) => ExprValue;
}

const operators: Record<string, Operator> = {
    '||': {
        precedence: 1,
        associativity: 'left',
        arity: 2,
        run: (a, b = null) => isTruthy(a) || isTruthy(b)
    },
    '&&': {
        precedence: 2,
        associativity: 'left',
        arity: 2,
        run: (a, b = null) => isTruthy(a) && isTruthy(b)
    },
    '==': {
        precedence: 3,
        associativity: 'left',
        arity: 2,
        run: (a, b = null) => equals(a, b)
    },
    '=': {
        precedence: 3,
        associativity: 'left',
        arity: 2,
        run: (a, b = null) => equals(a, b)
    },
    '!=': {
        precedence: 3,
        associativity: 'left',
        arity: 2,
        run: (a, b = null) => !equals(a, b)
    },
    '<': {
        precedence: 4,
        associativity: 'left',
        arity: 2,
        run: (a, b = null) => toNumber(a) < toNumber(b)
    },
    '>': {
        precedence: 4,
        associativity: 'left',
        arity: 2,
        run: (a, b = null) => toNumber(a) > toNumber(b)
    },
    '<=': {
        precedence: 4,
        associativity: 'left',
        arity: 2,
        run: (a, b = null) => toNumber(a) <= toNumber(b)
    },
    '>=': {
        precedence: 4,
        associativity: 'left',
        arity: 2,
        run: (a, b = null) => toNumber(a) >= toNumber(b)
    },
    '+': {
        precedence: 5,
        associativity: 'left',
        arity: 2,
        run: (a, b = null) => toNumber(a) + toNumber(b)
    },
    '-': {
        precedence: 5,
        associativity: 'left',
        arity: 2,
        run: (a, b = null) => toNumber(a) - toNumber(b)
    },
    '*': {
        precedence: 6,
        associativity: 'left',
        arity: 2,
        run: (a, b = null) => toNumber(a) * toNumber(b)
    },
    '/': {
        precedence: 6,
        associativity: 'left',
        arity: 2,
        run: (a, b = null) => toNumber(a) / toNumber(b)
    },
    '%': {
        precedence: 6,
        associativity: 'left',
        arity: 2,
        run: (a, b = null) => toNumber(a) % toNumber(b)
    },
    '^': {
        precedence: 7,
        associativity: 'right',
        arity: 2,
        run: (a, b = null) => toNumber(a) ** toNumber(b)
    },
    '!': { precedence: 8, associativity: 'right', arity: 1, run: (a) => !isTruthy(a) },
    'u-': { precedence: 8, associativity: 'right', arity: 1, run: (a) => -toNumber(a) }
};

type Token =
    | { type: 'literal'; value: ExprValue }
    | { type: 'node'; node: ValueNode }
    | { type: 'operator'; value: string }
    | { type: 'leftParen' }
    | { type: 'rightParen' };

const wordOperators: Record<string, string> = {
    and: '&&',
    or: '||',
    not: '!'
};

/** Evaluate a template expression. Non-text nodes become string value atoms. */
export async function evaluateExpression(
    template: Template,
    resolveNode: ResolveNode
): Promise<ExprValue> {
    return calculateRPNAsync(toRPN(tokenizeTemplate(template)), resolveNode);
}

/** Evaluate a standalone expression string. */
export function evaluate(text: string): ExprValue {
    return calculateRPNSync(toRPN(tokenizeText(text)));
}

export function calcString(text: string): ExprValue {
    return evaluate(text);
}

export function stringifyValue(value: ExprValue): string {
    if (value === null) return 'null';
    if (typeof value === 'boolean') return value ? '1' : '0';
    return String(value);
}

export function isTruthy(value: ExprValue): boolean {
    if (value === null) return false;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0 && !Number.isNaN(value);

    const normalized = value.trim().toLowerCase();
    return (
        normalized !== '' && normalized !== '0' && normalized !== 'false' && normalized !== 'null'
    );
}

function tokenizeTemplate(template: Template): Token[] {
    const tokens: Token[] = [];
    let expectOperand = true;

    for (const node of template) {
        if (node.type === 'text') {
            const result = tokenizeTextPart(node.value, expectOperand);
            tokens.push(...result.tokens);
            expectOperand = result.expectOperand;
            continue;
        }

        tokens.push({ type: 'node', node });
        expectOperand = false;
    }

    return tokens;
}

function tokenizeText(text: string): Token[] {
    return tokenizeTextPart(text, true).tokens;
}

function tokenizeTextPart(
    text: string,
    initialExpectOperand: boolean
): { tokens: Token[]; expectOperand: boolean } {
    const tokens: Token[] = [];
    let index = 0;
    let expectOperand = initialExpectOperand;

    while (index < text.length) {
        const char = text[index];

        if (/\s/.test(char)) {
            index += 1;
            continue;
        }

        if (char === '(') {
            tokens.push({ type: 'leftParen' });
            expectOperand = true;
            index += 1;
            continue;
        }

        if (char === ')') {
            tokens.push({ type: 'rightParen' });
            expectOperand = false;
            index += 1;
            continue;
        }

        const quoted = readQuotedString(text, index);
        if (quoted) {
            tokens.push({ type: 'literal', value: quoted.value });
            expectOperand = false;
            index = quoted.end;
            continue;
        }

        const word = readWordToken(text, index);
        if (word) {
            tokens.push(word.token);
            expectOperand = word.token.type === 'operator';
            index = word.end;
            continue;
        }

        const number = readNumber(text, index);
        if (number) {
            tokens.push({ type: 'literal', value: number.value });
            expectOperand = false;
            index = number.end;
            continue;
        }

        const operator = readOperator(text, index, expectOperand);
        if (!operator) {
            throw new Error(`Invalid expression token: ${char}`);
        }

        tokens.push({ type: 'operator', value: operator.value });
        expectOperand = true;
        index = operator.end;
    }

    return { tokens, expectOperand };
}

function readQuotedString(text: string, start: number): { value: string; end: number } | null {
    const quote = text[start];
    if (quote !== '"' && quote !== "'") return null;

    let value = '';
    let index = start + 1;

    while (index < text.length) {
        const char = text[index];

        if (char === quote) {
            return { value, end: index + 1 };
        }

        if (char === '\\') {
            const escaped = text[index + 1];
            if (escaped === undefined) break;
            value += unescapeChar(escaped);
            index += 2;
            continue;
        }

        value += char;
        index += 1;
    }

    throw new Error('Unterminated string literal');
}

function unescapeChar(char: string): string {
    if (char === 'n') return '\n';
    if (char === 'r') return '\r';
    if (char === 't') return '\t';
    return char;
}

function readNumber(text: string, start: number): { value: number; end: number } | null {
    const match = /^\d+(?:\.\d+)?/.exec(text.slice(start));
    if (!match) return null;

    return {
        value: Number(match[0]),
        end: start + match[0].length
    };
}

function readWordToken(text: string, start: number): { token: Token; end: number } | null {
    const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(start));
    if (!match) return null;

    const value = match[0].toLowerCase();
    const operator = wordOperators[value];
    if (operator) {
        return {
            token: { type: 'operator', value: operator },
            end: start + match[0].length
        };
    }

    if (value === 'true') {
        return { token: { type: 'literal', value: true }, end: start + match[0].length };
    }

    if (value === 'false') {
        return { token: { type: 'literal', value: false }, end: start + match[0].length };
    }

    if (value === 'null') {
        return { token: { type: 'literal', value: null }, end: start + match[0].length };
    }

    throw new Error(`Invalid expression identifier: ${match[0]}`);
}

function readOperator(
    text: string,
    start: number,
    expectOperand: boolean
): { value: string; end: number } | null {
    const two = text.slice(start, start + 2);
    if (two in operators) {
        return { value: two, end: start + 2 };
    }

    const one = text[start];
    if (one === '-' && expectOperand) {
        return { value: 'u-', end: start + 1 };
    }

    if (one in operators) {
        return { value: one, end: start + 1 };
    }

    return null;
}

function toRPN(tokens: Token[]): Token[] {
    const output: Token[] = [];
    const stack: Extract<Token, { type: 'operator' | 'leftParen' }>[] = [];

    for (const token of tokens) {
        if (token.type === 'literal' || token.type === 'node') {
            output.push(token);
            continue;
        }

        if (token.type === 'leftParen') {
            stack.push(token);
            continue;
        }

        if (token.type === 'rightParen') {
            while (stack.length > 0 && stack.at(-1)?.type !== 'leftParen') {
                output.push(stack.pop()!);
            }

            if (stack.at(-1)?.type !== 'leftParen') {
                throw new Error('Mismatched parentheses');
            }

            stack.pop();
            continue;
        }

        const op = operators[token.value];

        while (stack.length > 0 && stack.at(-1)?.type === 'operator') {
            const topToken = stack.at(-1);
            if (!topToken || topToken.type !== 'operator') break;

            const top = operators[topToken.value];
            const shouldPop =
                (op.associativity === 'left' && op.precedence <= top.precedence) ||
                (op.associativity === 'right' && op.precedence < top.precedence);

            if (!shouldPop) break;
            output.push(stack.pop()!);
        }

        stack.push(token);
    }

    while (stack.length > 0) {
        const token = stack.pop()!;
        if (token.type === 'leftParen') throw new Error('Mismatched parentheses');
        output.push(token);
    }

    return output;
}

async function calculateRPNAsync(tokens: Token[], resolveNode: ResolveNode): Promise<ExprValue> {
    const stack: ExprValue[] = [];

    for (const token of tokens) {
        if (token.type === 'literal') {
            stack.push(token.value);
            continue;
        }

        if (token.type === 'node') {
            stack.push(await resolveNode(token.node));
            continue;
        }

        applyOperator(token, stack);
    }

    return stack.pop() ?? 0;
}

function calculateRPNSync(tokens: Token[]): ExprValue {
    const stack: ExprValue[] = [];
    for (const token of tokens) {
        if (token.type === 'literal') {
            stack.push(token.value);
            continue;
        }

        if (token.type === 'node') {
            throw new Error('Unexpected template node in standalone expression');
        }

        applyOperator(token, stack);
    }

    return stack.pop() ?? 0;
}

function applyOperator(token: Token, stack: ExprValue[]): void {
    if (token.type !== 'operator') return;

    const op = operators[token.value];
    const right = stack.pop();

    if (right === undefined) {
        throw new Error(`Missing operand for operator: ${token.value}`);
    }

    if (op.arity === 1) {
        stack.push(op.run(right));
        return;
    }

    const left = stack.pop();
    if (left === undefined) {
        throw new Error(`Missing operand for operator: ${token.value}`);
    }

    stack.push(op.run(left, right));
}

function equals(a: ExprValue, b: ExprValue): boolean {
    const aNumber = tryNumber(a);
    const bNumber = tryNumber(b);
    if (aNumber !== null && bNumber !== null) return aNumber === bNumber;

    if (isBooleanLike(a) || isBooleanLike(b)) {
        return toBooleanComparable(a) === toBooleanComparable(b);
    }

    if (a === null || b === null) return a === b;
    return String(a) === String(b);
}

function isBooleanLike(value: ExprValue): boolean {
    if (typeof value === 'boolean') return true;
    if (typeof value !== 'string') return false;
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === 'false';
}

function toBooleanComparable(value: ExprValue): boolean | null {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true') return true;
        if (normalized === 'false') return false;
    }
    return null;
}

function toNumber(value: ExprValue): number {
    if (typeof value === 'number') return value;
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (value === null) return 0;

    const text = value.trim();
    if (text === '') return 0;

    const number = Number(text);
    if (!Number.isFinite(number)) {
        throw new Error(`Expected number: ${JSON.stringify(value)}`);
    }

    return number;
}

function tryNumber(value: ExprValue): number | null {
    if (typeof value === 'number') return value;
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (value === null) return null;

    const text = value.trim();
    if (text === '') return null;

    const number = Number(text);
    return Number.isFinite(number) ? number : null;
}
