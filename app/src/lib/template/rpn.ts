type Associativity = 'left' | 'right';

interface Operator {
    precedence: number;
    associativity: Associativity;
    arity: 1 | 2;
    run: (a: number, b?: number) => number;
}

const operators: Record<string, Operator> = {
    '||': { precedence: 1, associativity: 'left', arity: 2, run: (a, b = 0) => (a || b ? 1 : 0) },
    '&&': { precedence: 2, associativity: 'left', arity: 2, run: (a, b = 0) => (a && b ? 1 : 0) },
    '==': { precedence: 3, associativity: 'left', arity: 2, run: (a, b = 0) => (a === b ? 1 : 0) },
    '=': { precedence: 3, associativity: 'left', arity: 2, run: (a, b = 0) => (a === b ? 1 : 0) },
    '!=': { precedence: 3, associativity: 'left', arity: 2, run: (a, b = 0) => (a !== b ? 1 : 0) },
    '<': { precedence: 4, associativity: 'left', arity: 2, run: (a, b = 0) => (a < b ? 1 : 0) },
    '>': { precedence: 4, associativity: 'left', arity: 2, run: (a, b = 0) => (a > b ? 1 : 0) },
    '<=': { precedence: 4, associativity: 'left', arity: 2, run: (a, b = 0) => (a <= b ? 1 : 0) },
    '>=': { precedence: 4, associativity: 'left', arity: 2, run: (a, b = 0) => (a >= b ? 1 : 0) },
    '+': { precedence: 5, associativity: 'left', arity: 2, run: (a, b = 0) => a + b },
    '-': { precedence: 5, associativity: 'left', arity: 2, run: (a, b = 0) => a - b },
    '*': { precedence: 6, associativity: 'left', arity: 2, run: (a, b = 0) => a * b },
    '/': { precedence: 6, associativity: 'left', arity: 2, run: (a, b = 0) => a / b },
    '%': { precedence: 6, associativity: 'left', arity: 2, run: (a, b = 0) => a % b },
    '^': { precedence: 7, associativity: 'right', arity: 2, run: (a, b = 0) => a ** b },
    '!': { precedence: 8, associativity: 'right', arity: 1, run: (a) => (a ? 0 : 1) },
    'u-': { precedence: 8, associativity: 'right', arity: 1, run: (a) => -a }
};

type Token =
    | { type: 'number'; value: number }
    | { type: 'operator'; value: string }
    | { type: 'leftParen' }
    | { type: 'rightParen' };

/** Evaluate a small numeric expression. Boolean comparisons return 1 or 0. */
export function evaluate(text: string): number {
    return calculateRPN(toRPN(tokenize(text)));
}

export function calcString(text: string): number {
    return evaluate(text);
}

function tokenize(text: string): Token[] {
    const tokens: Token[] = [];
    let index = 0;
    let expectOperand = true;

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

        const word = readWord(text, index);
        if (word) {
            tokens.push({ type: 'number', value: wordToNumber(word.value) });
            expectOperand = false;
            index = word.end;
            continue;
        }

        const number = readNumber(text, index);
        if (number) {
            tokens.push({ type: 'number', value: number.value });
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

    return tokens;
}

function readNumber(text: string, start: number): { value: number; end: number } | null {
    const match = /^\d+(?:\.\d+)?/.exec(text.slice(start));
    if (!match) return null;

    return {
        value: Number(match[0]),
        end: start + match[0].length
    };
}

function readWord(text: string, start: number): { value: string; end: number } | null {
    const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(start));
    if (!match) return null;

    const value = match[0].toLowerCase();
    if (value !== 'true' && value !== 'false' && value !== 'null') {
        throw new Error(`Invalid expression identifier: ${match[0]}`);
    }

    return {
        value,
        end: start + match[0].length
    };
}

function wordToNumber(value: string): number {
    if (value === 'true') return 1;
    return 0;
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
        if (token.type === 'number') {
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

function calculateRPN(tokens: Token[]): number {
    const stack: number[] = [];

    for (const token of tokens) {
        if (token.type === 'number') {
            stack.push(token.value);
            continue;
        }

        if (token.type !== 'operator') continue;

        const op = operators[token.value];
        const right = stack.pop();

        if (right === undefined) {
            throw new Error(`Missing operand for operator: ${token.value}`);
        }

        if (op.arity === 1) {
            stack.push(op.run(right));
            continue;
        }

        const left = stack.pop();
        if (left === undefined) {
            throw new Error(`Missing operand for operator: ${token.value}`);
        }

        stack.push(op.run(left, right));
    }

    return stack.pop() ?? 0;
}
