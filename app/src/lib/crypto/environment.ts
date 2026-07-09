export type WebCryptoIssueKind =
    | 'insecure-context'
    | 'missing-crypto'
    | 'missing-subtle'
    | 'missing-random-values';

export interface WebCryptoAvailabilityIssue {
    kind: WebCryptoIssueKind;
    title: string;
    message: string;
}

export interface WebCryptoEnvironment {
    readonly isSecureContext?: boolean;
    readonly crypto?: {
        readonly subtle?: SubtleCrypto;
        readonly getRandomValues?: Crypto['getRandomValues'];
    };
}

const HELP_TEXT =
    'KeiAI needs a browser environment that supports Web Crypto for local identity and end-to-end encryption.';

export function getWebCryptoAvailabilityIssue(
    environment: WebCryptoEnvironment = globalThis
): WebCryptoAvailabilityIssue | null {
    if (!environment.crypto) {
        return {
            kind: 'missing-crypto',
            title: 'This browser cannot run KeiAI securely',
            message: HELP_TEXT
        };
    }

    if (!environment.crypto.subtle) {
        return {
            kind: environment.isSecureContext === false ? 'insecure-context' : 'missing-subtle',
            title:
                environment.isSecureContext === false
                    ? 'KeiAI requires a secure connection'
                    : 'This browser cannot run KeiAI securely',
            message: HELP_TEXT
        };
    }

    if (typeof environment.crypto.getRandomValues !== 'function') {
        return {
            kind: 'missing-random-values',
            title: 'This browser cannot run KeiAI securely',
            message: HELP_TEXT
        };
    }

    return null;
}
